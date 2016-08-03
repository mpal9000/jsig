'use strict';

var process = global.process;
var spawn = require('child_process').spawn;

function proxyToTypeScript() {
    var args = process.argv.slice(2);
    args.unshift('/home/raynos/projects/nvm/v0.10.32/lib/tsc.js');

    var proc = spawn('node', args);

    process.stdin.pipe(proc.stdin);

    proc.stdout.pipe(process.stdout);
    proc.stderr.pipe(process.stderr);
}

proxyToTypeScript();
