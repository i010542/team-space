function isCjkLetter(char) {
  const code = char.codePointAt(0);
  return code >= 0x3400 && code <= 0x9fff;
}

function isPunct(char) {
  return /[，。、；：？！,.;:?!\])]/.test(char);
}

function gap(left, right) {
  if (!left || !right) return "";
  const end = left.at(-1);
  const start = right[0];
  if (isPunct(end) || isPunct(start)) return "";
  if (isCjkLetter(end) && isCjkLetter(start)) return "";
  return " ";
}

function spaced(before, label, after = "") {
  return before + gap(before, label) + label + gap(label, after) + after;
}

module.exports = { spaced };
