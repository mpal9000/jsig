'use strict';

var process = global.process;
var childProcess = require('child_process');
var fs = require('fs');
var path = require('path');
var util = require('util');
var setTimeout = require('timers').setTimeout;

var TypeCheckBinary = require('../bin/jsig.js');

var logFile = path.join(__dirname, 'tsserver.log');
var logStream = fs.createWriteStream(logFile);

var TS_SERVER = path.join(
    '/home/raynos/projects/nvm/v0.10.32',
    'lib/node_modules/typescript',
    'lib/tsserver.js'
);

var SocketInspector = require('./socket-inspector.js');

var inspector = new SocketInspector({
    logger: {
        error: function error(msg, obj) {
            console.error(msg, obj);
        }
    }
});
inspector.enable();

function log(level, msg, info) {
    logStream.write(JSON.stringify({
        level: level,
        msg: msg,
        fields: info || {}
    }) + '\n');
}

function WARN(msg, info) {
    log('warn', msg, info);
}
function WARNTEXT(text) {
    log('warn', 'raw text', text.split('\n'));
}

function INFO(msg, info) {
    log('info', msg, info);
}

function tryJSONParse(str) {
    var json = null;

    /*eslint-disable no-restricted-syntax*/
    try {
        json = JSON.parse(str);
    } catch (err) {
        json = null;
    }
    /*eslint-enable no-restricted-syntax*/

    return json;
}

function TypeScriptProxy() {
    this.proc = null;
}

TypeScriptProxy.prototype.handleStdin =
function handleStdin(buf) {
    var str = buf.toString();
    var json = tryJSONParse(str);

    if (json) {
        INFO('got stdin json', {
            json: json
        });
    } else {
        INFO('got stdin buffer', {
            line: str
        });
    }

    if (json && json.type === 'request' && json.command === 'quickinfo' &&
        json.arguments.file.indexOf('.js') === json.arguments.file.length - 3
    ) {
        this.proc.stdin.write(buf);
        this.quickInfo(json.seq, json.arguments);
    } else {
        this.proc.stdin.write(buf);
    }
};

TypeScriptProxy.prototype.quickInfo =
function quickInfo(seqId, args) {
    INFO('doing a type check');

    var defns = path.join(
        __dirname, '..', '..', 'http-hash-server', 'definitions'
    );

    var bin = new TypeCheckBinary({
        _: [args.file],
        definitions: defns
    });

    bin.log = function noop() {};
    bin.exit = function exit() {};

    INFO('about to run type checker');

    bin.run();

    var meta = bin.checker.getOrCreateMeta(args.file);
    var ast = meta.ast;

    var astNodes = [];

    walkAST(ast, null, function onNode(node) {
        var loc = node.loc;

        if (!loc) {
            WARN('found weird shit\n');
            WARNTEXT(util.inspect(node));
            return;
        }

        var expectedLine = args.line;
        // var expectedOffset = args.offset;

        if (
            loc.start.line === expectedLine &&
            loc.end.line === expectedLine
        ) {
            astNodes.push(node);
        }
    });

    WARN('found nodes in range\n');
    WARNTEXT(util.inspect(astNodes));

    WARN('ran a check', {
        fileName: args.file,
        errorCount: bin.checker.errors.length
    });
};

function walkAST(node, parent, cb) {
    var keys = Object.keys(node);
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (key === 'parent') {
            continue;
        }
        if (key === '_jsigType') {
            continue;
        }

        var child = node[key];
        if (Array.isArray(child)) {
            for (var j = 0; j < child.length; j++) {
                var c = child[j];
                if (c && typeof c.type === 'string') {
                    c.parent = node;
                    walkAST(c, node, cb);
                }
            }
        } else if (child && typeof child.type === 'string') {
            child.parent = node;
            walkAST(child, node, cb);
        }
    }
    cb(node);
}

TypeScriptProxy.prototype.handleStdout =
function handleStdout(buf) {
    var res = buf.toString();
    var lines = res.split('\n');

    if (lines[0].indexOf('Content-Length') === 0) {
        var json = tryJSONParse(lines[2]);

        if (json) {
            INFO('got stdout response buffer', {
                json: json
            });
        } else {
            INFO('got stdout buffer', {
                lines: lines
            });
        }
    }

    process.stdout.write(buf);
};

TypeScriptProxy.prototype.spawn = function spawn() {
    var self = this;

    INFO('spawning tsserver.js');
    this.proc = childProcess.spawn('node', [TS_SERVER]);

    process.stdin.on('data', function onData(buf) {
        self.handleStdin(buf);
    });
    process.stdin.on('error', noop);
    function noop() {}

    process.stdin.on('end', function onEnd() {
        self.proc.stdin.end();
    });

    this.proc.stdout.on('data', function onData(buf) {
        self.handleStdout(buf);
    });
    this.proc.stdout.on('error', noop);

    this.proc.stderr.on('data', function onData(buf) {
        WARN('got stderr buffer', {
            line: buf.toString()
        });
        process.stderr.write(buf);
    });
    this.proc.stderr.on('error', noop);

    this.proc.on('exit', function onExit(code) {
        WARN('tsserver exited', {
            code: code
        });
    });
    this.proc.on('close', function onClose() {
        WARN('tsserver closed');
    });
};

function main() {
    INFO('spawning process');

    process.on('uncaughtException', function oops(err) {
        WARN('got uncaught', {
            error: err,
            message: err.message,
            stack: err.stack
        });

        setTimeout(function flushDelay() {
            /*eslint-disable no-process-exit*/
            process.exit(100);
            /*eslint-enable no-process-exit*/
        }, 500);
    });

    setInterval(function stayAlive() {
    }, 1000);

    var proxy = new TypeScriptProxy();
    proxy.spawn();
    INFO('spawned...');
}

main();
