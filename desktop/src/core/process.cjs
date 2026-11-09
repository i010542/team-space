const { spawn } = require("node:child_process");

function cleanEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:GIT_|GH_(?:TOKEN|ENTERPRISE_TOKEN|HOST|DEBUG)|GITHUB_(?:TOKEN|ENTERPRISE_TOKEN))/i.test(key)));
}

function runProcess(binary, args, { cwd, env, input, onOutput, timeout = 90000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, env, shell: false, windowsHide: true, stdio: "pipe" });
    const stdout = [];
    const stderr = [];
    let length = 0;
    let interrupted = false;
    const stop = () => { interrupted = true; child.kill(); };
    const timer = setTimeout(stop, timeout);
    const collect = (stream, output) => (chunk) => {
      length += chunk.length;
      if (length > 16 * 1024 * 1024) return stop();
      output.push(chunk);
      onOutput?.(chunk.toString("utf8"), stream);
    };
    child.stdout.on("data", collect("stdout", stdout));
    child.stderr.on("data", collect("stderr", stderr));
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: interrupted ? -1 : code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

function asText(value) {
  return Buffer.isBuffer(value) ? value.toString("utf8") : String(value ?? "");
}

module.exports = { cleanEnvironment, runProcess, asText };

