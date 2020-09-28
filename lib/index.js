const { parse, print } = require("recast");
const { namedTypes, builders, visit, eachField } = require("ast-types");

const node = parse(`
x == 1 ? func(10) : !y;
const x = 1;
function func(p) {
  return 1+p**2/4;
}
`);

function copyNode(node) {
  const copy = {};
  eachField(node, function (name, value) {
    copy[name] = value;
  });
  return copy;
}

function isLiteral(node) {
  return namedTypes.Literal.check(node);
}

const ops = {
  "==": (l, r) => l === r,
  "===": (l, r) => l === r,
  ">=": (l, r) => l >= r,
  "<=": (l, r) => l <= r,
  ">": (l, r) => l > r,
  "<": (l, r) => l < r,
  "!=": (l, r) => l != r,
  "*": (l, r) => l * r,
  "**": (l, r) => l ** r,
  "/": (l, r) => l / r,
  "+": (l, r) => l + r,
  "-": (l, r) => l - r,
};

function show(ast, indent) {
  indent = indent || "";
  console.log(`${indent}${ast.type}(${print(ast).code})`);
  for (const name in ast) {
    if (name === "tokens" || name === "type") {
      continue;
    }
    if (typeof ast[name] === "string") {
      console.log(`${indent} .${name} = ${JSON.stringify(ast[name])}`);
      continue;
    }
    if (ast[name] && ast[name].type) {
      console.log(`${indent} .${name}`);
      show(ast[name], indent + "  ");
    } else if (Array.isArray(ast[name])) {
      for (let i = 0; i < ast[name].length; i++) {
        if (ast[name][i] && ast[name][i].type) {
          console.log(`${indent} .${name}[${i}]`);
          show(ast[name][i], indent + "  ");
        }
      }
    }
  }
}

function partial(ast) {
  let changed = true;
  let iterations = 0;
  const substitutions = {};
  while (changed) {
    changed = false;
    console.log("--------------------");
    console.log(`Rewrite ${iterations}: ${print(node).code}`);
    console.log(`Variables: ${Object.keys(substitutions).join(", ")}`);
    iterations++;
    visit(ast, {
      visitVariableDeclaration(path) {
        const dec = path.node.declarations[0];
        const name = dec.id.name;
        const value = dec.init;
        if (
          name in substitutions &&
          print(substitutions[name]).code === print(value).code
        ) {
          this.traverse(path);
          return;
        }
        substitutions[name] = value;
        console.log("  assignment", name, "=", print(value).code);
        changed = true;
        path.replace(null);
        return false;
      },

      visitFunctionDeclaration(path) {
        const name = path.node.id.name;
        const params = path.node.params;
        const body = path.node.body;
        if (
          !name ||
          (name in substitutions &&
            print(substitutions[name]).code === print(body).code)
        ) {
          this.traverse(path);
          return;
        }
        substitutions[name] = builders.arrowFunctionExpression(params, body);
        console.log("  function", name);
        changed = true;
        path.replace(null);
        return false;
      },

      visitIdentifier(path) {
        if (path.parentPath.value.type === "VariableDeclarator") {
          // These don't get substituted
          this.traverse(path);
          return;
        }
        const name = path.node.name;
        if (!(name in substitutions)) {
          this.traverse(path);
          return;
        }
        changed = true;
        path.replace(copyNode(substitutions[name]));
        this.traverse(path);
      },

      visitBinaryExpression(path) {
        if (isLiteral(path.node.left) && isLiteral(path.node.right)) {
          const left = path.node.left.value;
          const right = path.node.right.value;
          const result = ops[path.node.operator](left, right);
          const sub = builders.literal(result);
          path.replace(sub);
          changed = true;
        }
        this.traverse(path);
      },

      visitConditionalExpression(path) {
        if (isLiteral(path.node.test)) {
          if (path.node.test.value) {
            path.replace(path.node.consequent);
          } else {
            path.replace(path.node.alternate);
          }
          changed = true;
        }
        this.traverse(path);
      },

      visitCallExpression(path) {
        const callee = path.node.callee;
        const args = path.node.arguments;
        if (
          namedTypes.ArrowFunctionExpression.check(callee) &&
          callee.params.length
        ) {
          const setters = [];
          for (let i = 0; i < callee.params.length; i++) {
            const name = callee.params[i].name;
            const arg = args[i];
            setters.push(
              builders.variableDeclaration("const", [
                builders.variableDeclarator(builders.identifier(name), arg),
              ])
            );
          }
          console.log("pre", print(callee.body).code);
          callee.body.body.splice(0, 0, ...setters);
          console.log("post", print(callee.body).code);
          callee.params = [];
          path.node.arguments = [];
          changed = true;
          return false;
        }
        if (
          namedTypes.ArrowFunctionExpression.check(callee) &&
          callee.body.body.length
        ) {
          const first = callee.body.body.filter((x) => x)[0];
          if (first && namedTypes.ReturnStatement.check(first)) {
            path.replace(first.argument);
            changed = true;
            return false;
          }
        }
        this.traverse(path);
      },
    });
  }
  return ast;
}

show(node);

partial(node);
