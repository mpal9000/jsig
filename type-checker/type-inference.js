'use strict';

var assert = require('assert');

var JsigAST = require('../ast/');
var isSameType = require('./lib/is-same-type.js');
var deepCloneJSIG = require('./lib/deep-clone-ast.js');

module.exports = TypeInference;

function TypeInference(meta) {
    this.meta = meta;
}

TypeInference.prototype.inferType = function inferType(node) {
    if (node.type === 'CallExpression') {
        return this.inferCallExpression(node);
    } else if (node.type === 'Literal') {
        return this.inferLiteral(node);
    } else if (node.type === 'ArrayExpression') {
        return this.inferArrayExpression(node);
    } else if (node.type === 'ObjectExpression') {
        return this.inferObjectExpression(node);
    } else {
        throw new Error('!! skipping inferType: ' + node.type);
    }
};

TypeInference.prototype.inferCallExpression =
function inferCallExpression(node) {
    var untypedFunc = this.meta.currentScope.getFunction(node.callee.name);
    if (!untypedFunc) {
        return null;
    }

    var args = node.arguments;

    var argTypes = [];
    for (var i = 0; i < args.length; i++) {
        var funcArg = this.meta.verifyNode(args[i], null);
        if (!funcArg) {
            return null;
        }

        argTypes.push(JsigAST.param(null, funcArg));
    }

    var returnType = JsigAST.literal('%Void%%UnknownReturn', true);
    if (this.meta.currentExpressionType) {
        returnType = this.meta.currentExpressionType;
    }

    // if (this.meta.currentScope.getAssignmentType()) {
        // returnType = this.meta.currentScope.getAssignmentType();
    // } else if (this.meta.currentScope.getReturnExpressionType()) {
        // returnType = this.meta.currentScope.getReturnExpressionType();
    // }

    // TODO: infer this arg based on method calls
    var funcType = JsigAST.functionType({
        args: argTypes,
        result: returnType,
        thisArg: null
    });

    if (!this.meta.tryUpdateFunction(node.callee.name, funcType)) {
        return null;
    }

    if (returnType.builtin && returnType.name === '%Void%%UnknownReturn') {
        // Grab the scope for the known function
        var funcScopes = this.meta.currentScope.getKnownFunctionInfo(
            node.callee.name
        ).funcScopes;

        assert(funcScopes.length === 1,
            'cannot infer call return for overloaded function'
        );
        var funcScope = funcScopes[0];

        if (funcScope.knownReturnType) {
            funcType.result = funcScope.knownReturnType;
        }
    }

    return funcType;
};

TypeInference.prototype.inferLiteral =
function inferLiteral(node) {
    var value = node.value;

    if (typeof value === 'string') {
        return JsigAST.literal('String', true, {
            concreteValue: value
        });
    } else if (typeof value === 'number') {
        return JsigAST.literal('Number');
    } else if (value === null) {
        return JsigAST.value('null');
    } else if (Object.prototype.toString.call(value) === '[object RegExp]') {
        return JsigAST.literal('RegExp');
    } else if (typeof value === 'boolean') {
        return JsigAST.literal('Boolean');
    } else {
        throw new Error('not recognised literal');
    }
};

TypeInference.prototype.inferArrayExpression =
function inferArrayExpression(node) {
    var elems = node.elements;

    if (elems.length === 0) {
        var currExprType = this.meta.currentExpressionType;
        if (currExprType && currExprType.type === 'genericLiteral' &&
            currExprType.value.type === 'typeLiteral' &&
            currExprType.value.builtin && currExprType.value.name === 'Array'
        ) {
            return currExprType;
        }

        return JsigAST.generic(
            JsigAST.literal('Array'),
            [JsigAST.freeLiteral('T')]
        );
    }

    if (this.meta.currentExpressionType &&
        this.meta.currentExpressionType.type === 'tuple'
    ) {
        return this._inferTupleExpression(node);
    }

    var type = null;
    for (var i = 0; i < elems.length; i++) {
        var newType = this.meta.verifyNode(elems[i], null);
        if (type) {
            assert(isSameType(newType, type), 'arrays must be homogenous');
        }
        type = newType;
    }

    if (!type) {
        return null;
    }

    return JsigAST.generic(JsigAST.literal('Array'), [type]);
};

TypeInference.prototype._inferTupleExpression =
function _inferTupleExpression(node) {
    var values = [];

    assert(this.meta.currentExpressionType &&
        this.meta.currentExpressionType.type === 'tuple',
        'must be a tuple...'
    );

    var tupleTypes = this.meta.currentExpressionType.values;

    for (var i = 0; i < node.elements.length; i++) {
        var expected = tupleTypes[i];

        values[i] = this.meta.verifyNode(node.elements[i], expected);
    }

    return JsigAST.tuple(values);
};

TypeInference.prototype.inferObjectExpression =
function inferObjectExpression(node) {
    var properties = node.properties;

    if (properties.length === 0) {
        var openObj = JsigAST.object([]);
        openObj.open = true;
        return openObj;
    }

    var currentExpressionType = this.meta.currentExpressionType;
    var index = null;
    if (currentExpressionType && currentExpressionType.type === 'object') {
        index = currentExpressionType.buildObjectIndex();
    }

    var keyValues = [];
    for (var i = 0; i < properties.length; i++) {
        var prop = properties[i];
        assert(prop.kind === 'init', 'only support init kind');

        var keyName = null;
        if (prop.key.type === 'Identifier') {
            keyName = prop.key.name;
        } else if (prop.key.type === 'Literal') {
            keyName = prop.key.value;
        }

        var expectedType = null;
        if (keyName && index && index[keyName]) {
            expectedType = index[keyName];
        }

        var value = this.meta.verifyNode(prop.value, expectedType);
        if (!value) {
            return null;
        }

        keyValues.push(JsigAST.keyValue(keyName, value));
    }

    return JsigAST.object(keyValues);
};

TypeInference.prototype.resolveGeneric =
function resolveGeneric(funcType, node, currentExpressionType) {
    /*
        CallExpression : {
            callee: {
                type: 'MemberExpression',
                object: { type: 'Identifier' }
            },
            arguments: Array<X>
        }

        NewExpression : {
            callee: { type: 'Identifier' },
            arguments: Array<X>
        }
    */

    var copyFunc = deepCloneJSIG(funcType);
    copyFunc._raw = null;

    var knownGenericTypes = this._findGenericTypes(
        copyFunc, node, currentExpressionType
    );
    if (!knownGenericTypes) {
        return null;
    }

    for (var i = 0; i < copyFunc.generics.length; i++) {
        var g = copyFunc.generics[i];
        var newType = knownGenericTypes[g.name];
        assert(newType, 'newType must exist');

        var stack = g.location.slice();

        var obj = copyFunc;
        for (var j = 0; j < stack.length - 1; j++) {
            obj = obj[stack[j]];
            obj._raw = null;
        }

        var lastProp = stack[stack.length - 1];
        obj[lastProp] = newType;
    }

    return copyFunc;
};

/*eslint complexity: [2, 25], max-statements: [2, 60] */
TypeInference.prototype._findGenericTypes =
function _findGenericTypes(copyFunc, node, currentExpressionType) {
    var knownGenericTypes = Object.create(null);

    for (var i = 0; i < copyFunc.generics.length; i++) {
        var g = copyFunc.generics[i];

        var newType;
        var referenceNode;
        var stack = g.location;
        var ast = walkProps(copyFunc, stack, 0);

        if (stack[0] === 'args') {
            referenceNode = node.arguments[stack[1]];
            newType = this.meta.verifyNode(referenceNode, null);
            if (!newType) {
                return null;
            }

            newType = walkProps(newType, stack, 3);
        } else if (stack[0] === 'thisArg') {

            // Method call()
            if (node.callee.type === 'MemberExpression') {
                referenceNode = node.callee.object;
                // TODO: this might be wrong
                newType = this.meta.verifyNode(referenceNode, null);
                if (!newType) {
                    return null;
                }

                newType = walkProps(newType, stack, 2);
            // new expression
            } else if (node.callee.type === 'Identifier') {
                if (currentExpressionType) {
                    newType = currentExpressionType;
                    newType = walkProps(newType, stack, 2);
                } else {
                    // If we have no ctx as for type then free literal
                    newType = JsigAST.freeLiteral('T');
                }
            } else {
                assert(false, 'unknown caller type: ' + node.callee.type);
            }
        } else {
            referenceNode = node;
            newType = knownGenericTypes[ast.name];
            assert(newType, 'newType must exist in fallback');
        }

        if (!newType) {
            return null;
        }

        if (knownGenericTypes[ast.name]) {
            var oldType = knownGenericTypes[ast.name];

            var subTypeError;
            if (newType.type === 'freeLiteral') {
                subTypeError = null;
            } else {
                subTypeError = this.meta.checkSubTypeRaw(
                    referenceNode, oldType, newType
                );
            }

            if (subTypeError) {
                // A free variable fits in any type.
                var isSub = oldType.type === 'freeLiteral';
                if (!isSub) {
                    isSub = this.meta.isSubType(
                        referenceNode, newType, oldType
                    );
                }
                if (isSub) {
                    knownGenericTypes[ast.name] = newType;
                    subTypeError = null;
                }
            }

            if (subTypeError) {
                this.meta.addError(subTypeError);
                return null;
                // TODO: bug and shit
                // assert(false, 'could not resolve generics');
            }
        } else {
            knownGenericTypes[ast.name] = newType;
        }
    }

    return knownGenericTypes;
};

function walkProps(object, stack, start) {
    for (var i = start; i < stack.length; i++) {
        if (!object) {
            return null;
        }

        object = object[stack[i]];
    }
    return object;
}
