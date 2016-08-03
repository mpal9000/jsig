'use strict';

var path = require('path');
var fs = require('fs');
var childProcess = require('child_process');
var process = global.process;

var file = path.join(__dirname, '_tsserver.js');
var stdoutFile = path.join(__dirname, 'tsserver.stdout.log');
var stderrFile = path.join(__dirname, 'tsserver.stderr.log');

var proc = childProcess.spawn('node', [file]);

process.stdin.pipe(proc.stdin);
process.stdin.on('error', noop);

proc.stdout.pipe(fs.createWriteStream(stdoutFile));
proc.stdout.pipe(process.stdout);

proc.stderr.pipe(fs.createWriteStream(stderrFile));
proc.stderr.pipe(process.stderr);

proc.stderr.on('error', noop);
proc.stdout.on('error', noop);
function noop() {}

proc.on('exit', function (code) {
    process.exit(code);
});
