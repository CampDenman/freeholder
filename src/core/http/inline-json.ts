// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// JSON placed inside an HTML script element must not contain an HTML parser
// terminator. JSON escaping alone does not escape `</script>`.
export function serializeInlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => {
    switch (character) {
      case "<":
        return "\\u003c";
      case ">":
        return "\\u003e";
      case "&":
        return "\\u0026";
      case "\u2028":
        return "\\u2028";
      default:
        return "\\u2029";
    }
  });
}
