'use strict';

var extend = require('xtend');

var serializers = {
    program: serializeProgram,
    typeDeclaration: serializeTypeDeclaration,
    assignment: serializeAssignment,
    'import': serializeImportStatement,
    object: serializeObject,
    unionType: serializeUnion,
    intersectionType: serializeIntersection,
    typeLiteral: serializeLiteral,
    keyValue: serializeKeyValue,
    valueLiteral: serializeValue,
    function: serializeFunctionType,
    genericLiteral: serializeGeneric,
    tuple: serializeTuple,
    renamedLiteral: serializeRenamedLiteral
};

module.exports = serialize;

function serialize(ast, opts) {
    opts = opts || { indent: 0, lineStart: 0 };

    if (ast._raw) {
        return serialize(ast._raw, opts);
    }

    var fn = serializers[ast.type];

    if (!fn) {
        throw new Error('unknown ast type: ' + ast.type);
    }

    return fn(ast, opts);
}

function serializeProgram(node, opts) {
    var tokens = [];
    for (var i = 0; i < node.statements.length; i++) {
        tokens.push(serialize(node.statements[i], opts));
    }

    var text = tokens[0];
    var isImport = node.statements[0].type === 'import';
    for (i = 1; i < tokens.length; i++) {
        isImport = node.statements[i].type === 'import';
        text += isImport ? '\n' : '\n\n';
        text += tokens[i];
    }

    if (tokens.length > 1) {
        text += '\n';
    }

    return text;
}

function serializeTypeDeclaration(node, opts) {
    var tokens = [];
    for (var i = 0; i < node.generics.length; i++) {
        tokens.push(serialize(node.generics[i], opts));
    }

    var generics = tokens.length ?
        '<' + tokens.join(', ') + '>' : '';
    var str = 'type ' + node.identifier + generics + ' : ';

    return str + serialize(node.typeExpression, extend(opts, {
        lineStart: str.length
    }));
}

function serializeAssignment(node, opts) {
    return node.identifier + ' : ' +
        serialize(node.typeExpression, opts);
}

function serializeImportStatement(node, opts) {
    var tokens;

    if (node.types.length <= 1) {
        tokens = [];
        for (var i = 0; i < node.types.length; i++) {
            tokens.push(serialize(node.types[i]));
        }

        var content = 'import { ' + tokens.join(', ') +
            ' } from "' + node.dependency + '"';

        if (content.length < 65 && content.indexOf('\n') === -1) {
            return content;
        }
    }

    tokens = [];
    for (i = 0; i < node.types.length; i++) {
        tokens.push(serialize(node.types[i], extend(opts, {
            indent: opts.indent + 1
        })));
    }

    return 'import {\n' + tokens.join(',\n') + '\n' +
        spaces(opts.indent) + '} from "' + node.dependency + '"';
}

function serializeLabel(node) {
    return node.label ?
        node.label + (node.optional ? '?' : '') + ': ' :
        '';
}

function serializeObject(node, opts) {
    var keyValues = node.keyValues;
    var tokens;

    if (keyValues.length === 0) {
        return serializeLabel(node, opts) + '{}';
    }

    /* heuristic. Pretty print single key, value on one line */
    if (keyValues.length <= 1) {
        tokens = [];
        for (var i = 0; i < keyValues.length; i++) {
            tokens.push(serialize(keyValues[i]));
        }
        var content = serializeLabel(node, opts) + '{ ' +
            tokens.join(', ') + ' }';

        if (content.length < 65 &&
            content.indexOf('\n') === -1
        ) {
            return content;
        }
    }

    tokens = [];
    for (i = 0; i < keyValues.length; i++) {
        tokens.push(serialize(keyValues[i], extend(opts, {
            indent: opts.indent + 1
        })));
    }

    return serializeLabel(node, opts) + '{\n' +
        tokens.join(',\n') + '\n' + spaces(opts.indent) + '}';
}

function prettyFormatList(labelStr, tokens, seperator, opts) {
    var parts = [''];
    for (var i = 0; i < tokens.length; i++) {
        var token = tokens[i];

        var lastIndex = parts.length - 1;
        var last = parts[lastIndex];
        var len = (last + token + seperator).length;

        if (opts.lineStart) {
            len += opts.lineStart;
        }

        if (len < 65) {
            parts[lastIndex] += token + seperator;
            return parts;
        }

        if (opts.lineStart) {
            opts.lineStart = 0;
        }

        parts[parts.length] = spaces(opts.indent + 1) +
            trimLeft(token) + seperator;
    }

    var str = labelStr + parts.join('\n');
    // remove extra {seperator} at the end
    return str.substr(0, str.length - 1);
}

function serializeUnion(node, opts) {
    var labelStr = serializeLabel(node);
    var nodes = [];
    for (var i = 0; i < node.unions.length; i++) {
        nodes.push(serialize(node.unions[i], opts));
    }
    var str = labelStr + nodes.join(' | ');

    /* heuristic. Split across multiple lines if too long */
    if (str.split('\n')[0].length > 65) {
        str = prettyFormatList(labelStr, nodes, ' | ', opts);
    }

    return str;
}

function serializeIntersection(node, opts) {
    var labelStr = serializeLabel(node);
    var nodes = [];
    for (var i = 0; i < node.intersections.length; i++) {
        nodes.push(serialize(node.intersections[i], opts));
    }

    var str = labelStr + nodes.join(' & ');

    /* heuristic. Split across multiple lines if too long */
    if (str.split('\n')[0].length > 65) {
        str = prettyFormatList(labelStr, nodes, ' & ', opts);
    }

    return str;
}

function serializeLiteral(node, opts) {
    return serializeLabel(node, opts) + node.name;
}

function serializeKeyValue(node, opts) {
    return spaces(opts.indent) + node.key +
        (node.optional ? '?' : '') + ': ' +
        serialize(node.value, opts);
}

function serializeValue(node, opts) {
    return serializeLabel(node, opts) + node.value;
}

function serializeFunctionType(node, opts) {
    var str = serializeLabel(node, opts) + '(';
    var argNodes = node.args.slice();

    if (node.thisArg) {
        argNodes.unshift(node.thisArg);
    }

    var argStrs = [];
    for (var i = 0; i < argNodes.length; i++) {
        argStrs.push(serialize(argNodes[i], opts));
    }
    var argStr = argStrs.join(', ');

    if (argStrs.join(', ').split('\n')[0].length > 65) {
        var offset = '\n' + spaces(opts.indent + 1);
        argStrs = [];
        for (i = 0; i < argNodes.length; i++) {
            argStrs.push(serialize(argNodes[i], extend(opts, {
                indent: opts.indent + 1
            })));
        }
        argStr = offset + argStrs.join(',' + offset) + '\n';
        argStr += spaces(opts.indent);
    }

    str += argStr + ') => ' +
        serialize(node.result, opts);

    return str;
}

function serializeGeneric(node, opts) {
    var nodes = [];
    for (var i = 0; i < node.generics.length; i++) {
        nodes.push(serialize(node.generics[i], opts));
    }

    return serializeLabel(node, opts) +
        serialize(node.value, opts) +
        '<' + nodes.join(', ') + '>';
}

function serializeTuple(node, opts) {
    var nodes = [];
    for (var i = 0; i < node.values.length; i++) {
        nodes.push(serialize(node.values[i], opts));
    }

    return serializeLabel(node, opts) +
        '[' + nodes.join(', ') + ']';
}

function serializeRenamedLiteral(node, opts) {
    return serializeLabel(node, opts) + ' ' +
        serialize(node.original) + ' as ' + node.name;
}

function spaces(n) {
    n = n * 4;
    var str = '';
    for (var i = 0; i < n; i++) {
        str += ' ';
    }
    return str;
}

function trimLeft(str) {
    return str.replace(/^\s+/, '');
}
