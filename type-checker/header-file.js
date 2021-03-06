'use strict';

var assert = require('assert');
var path = require('path');
var resolve = require('resolve');

var Errors = require('./errors.js');
var JsigASTReplacer = require('./lib/jsig-ast-replacer.js');
var JsigAST = require('../ast/');
var deepCloneJSIG = require('./lib/deep-clone-ast.js');

module.exports = HeaderFile;

function HeaderFile(checker, jsigAst, fileName, source) {
    this.checker = checker;
    this.source = source;
    this.fileName = fileName;
    this.folderName = path.dirname(fileName);
    this.rawJsigAst = jsigAst;
    this.resolvedJsigAst = null;

    this.indexTable = Object.create(null);
    this.exportType = null;
    this.errors = [];
    this.astReplacer = new JsigASTReplacer(this);
}

HeaderFile.prototype.replace = function replace(ast, rawAst) {
    if (ast.type === 'typeLiteral') {
        return this.replaceTypeLiteral(ast, rawAst);
    } else if (ast.type === 'import') {
        return this.replaceImport(ast, rawAst);
    } else if (ast.type === 'genericLiteral') {
        return this.replaceGenericLiteral(ast, rawAst);
    } else {
        assert(false, 'unexpected ast.type: ' + ast.type);
    }
};

HeaderFile.prototype.getToken =
function getToken(name) {
    return this.indexTable[name];
};

/*eslint dot-notation: 0*/
HeaderFile.prototype.replaceTypeLiteral =
function replaceTypeLiteral(ast, rawAst) {
    var name = ast.name;

    if (name === 'Error' && !this.indexTable['Error']) {
        this.checker.loadJavaScriptIntoIndexTable(this.indexTable);
    }

    var typeDefn = this.indexTable[name];
    if (!typeDefn) {
        this.errors.push(Errors.UnknownLiteralError({
            literal: name,
            loc: ast.loc,
            line: ast.line,
            source: this.source
        }));
        return null;
    }

    return typeDefn;
};

HeaderFile.prototype.replaceGenericLiteral =
function replaceGenericLiteral(ast, rawAst) {
    var name = ast.value.name;

    var typeDefn = this.indexTable[name];
    if (!typeDefn) {
        this.errors.push(Errors.UnknownLiteralError({
            literal: name
        }));
        return null;
    }

    return typeDefn;
};

HeaderFile.prototype._getHeaderFile =
function _getHeaderFile(importNode) {
    var depPath = importNode.dependency;
    var fileName = this._resolvePath(depPath, this.folderName);
    if (fileName === null) {
        // Could not resolve header
        this.errors.push(Errors.CouldNotFindHeaderFile({
            otherFile: depPath,
            loc: importNode.loc,
            line: importNode.line,
            source: this.source
        }));
        return null;
    }

    var otherHeader = this.checker.getOrCreateHeaderFile(
        fileName, importNode, this.source
    );
    return otherHeader;
};

// Find another HeaderFile instance for filePath
// Then reach into indexTable and grab tokens
// Copy tokens into local index table
HeaderFile.prototype.replaceImport =
function replaceImport(ast, rawAst) {
    if (ast.isMacro) {
        return this.replaceImportMacro(ast, rawAst);
    }

    var otherHeader = this._getHeaderFile(ast);
    if (!otherHeader) {
        return ast;
    }

    for (var i = 0; i < ast.types.length; i++) {
        var t = ast.types[i];
        assert(t.type === 'typeLiteral', 'expected typeLiteral');

        if (!otherHeader.indexTable[t.name]) {
            this.errors.push(Errors.CannotImportToken({
                identifier: t.name,
                otherFile: otherHeader.fileName,
                loc: t.loc,
                line: t.line,
                source: this.source
            }));
            continue;
        }

        this.addToken(t.name, otherHeader.indexTable[t.name]);
    }

    return ast;
};

HeaderFile.prototype.replaceImportMacro =
function replaceImportMacro(ast, rawAst) {
    var filePath = resolve.sync(ast.dependency, {
        basedir: this.folderName
    });

    for (var i = 0; i < ast.types.length; i++) {
        var t = ast.types[i];
        assert(t.type === 'typeLiteral', 'expected typeLiteral');

        var macro = JsigAST.macroLiteral(t.name, filePath);
        this.addToken(t.name, macro);
    }

    return ast;
};

HeaderFile.prototype._resolvePath =
function resolvePath(possiblePath, dirname) {
    if (possiblePath[0] === path.sep) {
        // is absolute path
        return possiblePath;
    } else if (possiblePath[0] === '.') {
        // is relative path
        return path.resolve(dirname, possiblePath);
    } else {
        // TODO: improve handling to reach into sub modules
        assert(possiblePath.indexOf('/') === -1,
            'node_modules nested files lookup not implemented');

        return this.checker.getDefinitionFilePath(possiblePath);
    }
};

HeaderFile.prototype.addToken =
function addToken(token, defn) {
    assert(!this.indexTable[token], 'cannot double add token');
    this.indexTable[token] = defn;
};

HeaderFile.prototype.addDefaultExport =
function addDefaultExport(defn) {
    assert(this.exportType === null, 'cannot have double export');
    this.exportType = defn;
};

HeaderFile.prototype.resolveReferences =
function resolveReferences() {
    if (this.resolvedJsigAst) {
        return;
    }

    var ast = this.rawJsigAst;
    var copyAst = deepCloneJSIG(ast);

    for (var i = 0; i < copyAst.statements.length; i++) {
        var line = copyAst.statements[i];

        if (line.type === 'typeDeclaration') {
            if (line.typeExpression.type === 'typeLiteral') {
                assert(line.typeExpression.builtin,
                    'cannot alias non-builtin types...');
            }
            this.addToken(line.identifier, line.typeExpression);
        }
    }

    copyAst = this.astReplacer.inlineReferences(copyAst, ast);

    // Hoist default export only after inlining it.
    for (i = 0; i < copyAst.statements.length; i++) {
        line = copyAst.statements[i];

        if (line.type === 'defaultExport') {
            this.addDefaultExport(line.typeExpression);
        }
    }

    this.resolvedJsigAst = copyAst;
};

HeaderFile.prototype.getResolvedAssignments =
function getResolvedAssignments() {
    this.resolveReferences();

    if (!this.resolvedJsigAst) {
        return null;
    }

    var statements = [];
    for (var i = 0; i < this.resolvedJsigAst.statements.length; i++) {
        if (this.resolvedJsigAst.statements[i].type === 'assignment') {
            statements.push(this.resolvedJsigAst.statements[i]);
        }
    }

    return statements;
};

HeaderFile.prototype.getExportType =
function getExportType() {
    this.resolveReferences();

    return this.exportType;
};
