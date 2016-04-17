# jsig2

From scratch type-checker

# rtype compatibility branch

This branch aims to build up compatibility with the rtype type
definition language.

### Implemented

 - `T[]` as an alias for `Array<T>`
 - named signatures like `connect(options: Object) => connection: Object`
 - anonymous optional args `toggle(String, ?: Boolean) => Boolean`
 - constructor syntax like `new User({ username: String }) => UserInstance`
 - interfaces like `interface Foo { bar: String }`
 - value literals like strings and numbers
 - `Void` type is implemented as alias for `void`.

### Not implemented

 - splats `(...args: String[]) => Any`. Type checker doesn't know about splats yet.
 - default args `(myArray: []) => Any`. Default args are non trivial if we allow non-trivial defaults like objects, it also means we need to do javascript value inference in the type definition language to find the actual type of the signature
 - `Any`. One of the core principles of my type checker is correctness. Any place where `Any` is used we should use `mixed` instead. The type checker implements flow based restrictions and reflection to be able to operate on `mixed`.
 - `Symbol`. The typechecker is currently restricted to ES5 and does not know what a symbole is yet.
 - `Predicate`. The Predicate type is not implemented for simplicity. It is just a function that returns a boolean. Currently the type checker has no special semantics for predicate style functions with respect to flow typing.
 - Throwing functions like `(paramName: Type) => Type, throws: TypeError|DOMException`. Currently the type checker does not track throws vs not throws in the system. Punting on adding throwing syntax as part of function until we implement something for it.
 - Dependencies like `signatureName() => Type, requires: functionA`. Dependencies have no semantics in the type checker. both dependencies and throws could be implemented as function meta data on the function AST.
 - Function interface. Currently we do not fully support intersections of functions, aka function overloading. We also do not support function intersections with objects
 - interface with methods. This syntax is ambigious. Is it a constructor and methods or is it a function with properties on it...
 - Limited builtin type support, we do not support arbitrary javascript value expressions, only strings and numbers.
 - Predicate literals like `interface Integer (number) => number === parseInt(number, 10);`. This effectively requires the type system to be dependently typed and even then it wouldn't allow for arbitrary javascript functions.
 - Type composition. There is limited support for `&` in the type system so I've not yet added support for the spread syntax.

# progress ( 0.1.0 )

The `v0.1.0` tag was cut. I skipped on a few tests...

 - [x] type check constructor
 - [x] type check method definition
 - [x] type check new Foo()
 - [x] type check method calls 
 - [x] support module system
 - [ ] write more module system tests
 - [x] create binary with pretty errors.

# progress ( 0.2.0 )

The `v0.2.0` will be cut once a full reference library type checks

 - [x] define type definitions for npm modules
 - [ ] write more type definition tests
 - [ ] support more JavaScript features.
 - [x] basic support for logic expressions.
 - [ ] write more logic expression tests.
 - [ ] basic support for nullables
 - [ ] basic support for if branches and flow analysis
 - [ ] basic support for generics

# Stability status: Experimental

This project is pre-alpha and an experimental type checker.

There are a lot of rough edges, sometimes the type checker will
report pretty errors and sometimes it just aborts.

This project is only interesting if you actually want to implement
or contribute to a type checker.

# Motivation

JSIG started as a tool for documenting your projects and libraries
in a human readable way, as an alternative to jsdoc.

This was great for documentation but suffered from the staleness
problem which can be best addressed by having a tool that verifies
the documentation and the source code agree, a type checker.

The JSIG type checker is designed to work on existing ES5 code
without having to fix anything other then type errors. This means
full support for constructor function and type inference to verify
all of the code.

Currently the JSIG type checker relies on external type definitions
in header files. Generally you will only have type definitions
for anything exported by a module and the rest of the module will
be checked through type inference

## Why not Typescript ?

JSIG is solving a slightly different set of issues

 - Human readable documentation for a module
 - Type checking for existing code bases.
 - Fully support ES5.
 - No runtime overhead
 - No compile step, no source maps.

Typescript provides a great type system and has stellar IDE support.
However it only supports TypeScript, a superset of ES6. It also
comes with a full compiler and can add runtime overhead. Typescript
does not work on existing ES5 code without converting to ES6.

JSIG offers a different approach by taking an existing vanilla
codebase and annotating it within header files that do not effect
your production code in any way or form.

## Why not Flow ?

Flow has similar, but slightly different issues. It does have a 
working comment mode that can be used on existing JavaScript without
a compile step or runtime overhead.

However the type system doesn't have proper support for ES5 and
in practice the type system is too optional/gradual and allows
for accidentally leaving strictness holes. When using external
declarations or relying on call site inference, sometimes a
function is unused and unchecked.

JSIG takes a different approach by focusing on ES5 and external
annotations as a first class citizen. JSIG also heavily relies
on inference but will complain if it cannot safely infer something.

# Hello world example

There is a small hello world example that shows inference.

```js
'use strict';

function foo(x) {
    return x * 10;
}

foo('Hello, world!');
```

```
raynos at raynos-Dell-Precision-M3800  ~/projects/jsig2 on master*
$ jsig ./examples/hello.js 

examples/hello.js
Found error: jsig.sub-type.type-class-mismatch
@4: Got unexpected type class. Expected Number but got String

2. function foo(x) {
3.     return x * 10;
4. }

Expected : Number
Actual   : String

Found (1) error
```

## More examples

```
raynos at raynos-Dell-Precision-M3800  ~/projects/jsig2 on master*
$ jsig examples/2-main.js 
No type errors
```

There is a `2-main.js` that shows a small program that type checks

This includes the module system and the definition files.

## Definitions example

```
raynos at raynos-ThinkPad-T440p  ~/projects/jsig2 on master*
$ jsig ./examples/3-node_modules.js --definitions ./definitions/

examples/3-node_modules.js
Found error: jsig.sub-type.type-class-mismatch
@21: Got unexpected type class. Expected Number but got result: String

19.             headLine: str.split('\n').slice(0, 3),
20.             invalidField: str * 2
21.         });

Expected : Number
Actual   : result: String

Found (1) error
```

There is a `3-node_modules.js` example that shows how to use external
definitions. In this case we pass the `./definitions/` folder that
is part of jsig2 and contains stubs for modules defined in node core.

This is an example of how to define definitions for modules that you
did not author or that are not part of your current code repository.

This approach works for both npm modules and node core modules.

## Even more examples

There are a lot of tests that show examples

```
raynos at raynos-Dell-Precision-M3800  ~/projects/jsig2 on master*
$ git ls-files | grep test | grep 'hjs'
test/batch-client-calls/bad-assign-result-of-method-to-wrong-type.hjs
test/batch-client-calls/bad-call-method-with-wrong-argument.hjs
test/batch-client-calls/bad-calling-method-on-primitive.hjs
test/batch-client-calls/bad-calling-method-on-wrong-object.hjs
test/batch-client-calls/bad-calling-method-with-extra-args.hjs
...
```
