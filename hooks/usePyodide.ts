"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Problem, RunResult } from "@/lib/types";

const CDN = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";

// Runs the candidate's function against the problem's tests. Values are shown as Python writes them (True, 'text', None).
const HARNESS = `
import json, io, sys, traceback
_buf = io.StringIO()
_old = sys.stdout
sys.stdout = _buf
_results, _err = [], None
def _same(got, expected):
    try:
        if ANY_ORDER:
            return got is not None and sorted(list(got)) == sorted(expected)
        # True == 1 in Python, so a boolean only matches a boolean
        return isinstance(got, bool) == isinstance(expected, bool) and got == expected
    except Exception:
        return False
try:
    _params = json.loads(PARAMS_JSON)
    _ns = {}
    exec(USER_CODE, _ns)
    _fn = _ns.get(FN_NAME)
    if _fn is None:
        raise NameError("Define a function named " + FN_NAME)
    for _test in json.loads(TESTS_JSON):
        _args, _expected = _test["args"], _test["expected"]
        _row = {"input": ", ".join("%s = %r" % (n, a) for n, a in zip(_params, _args)), "expected": repr(_expected)}
        try:
            _got = _fn(*[list(a) if isinstance(a, list) else a for a in _args])
            _row["got"] = repr(_got)
            _row["ok"] = _same(_got, _expected)
        except Exception as e:
            _row["got"] = type(e).__name__ + ": " + str(e)
            _row["ok"] = False
        _results.append(_row)
except Exception:
    _err = traceback.format_exc(limit=-1)
sys.stdout = _old
json.dumps({"error": _err, "stdout": _buf.getvalue()[-2000:], "results": _results})
`;

export function usePyodide() {
  const pyRef = useRef<any>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = CDN + "pyodide.js";
    script.onload = async () => {
      pyRef.current = await (window as any).loadPyodide({ indexURL: CDN });
      setReady(true);
    };
    document.body.appendChild(script);
  }, []);

  const run = useCallback(async (code: string, problem: Problem): Promise<RunResult> => {
    const py = pyRef.current;
    py.globals.set("USER_CODE", code);
    py.globals.set("FN_NAME", problem.functionName);
    py.globals.set("PARAMS_JSON", JSON.stringify(problem.params));
    py.globals.set("TESTS_JSON", JSON.stringify(problem.tests));
    py.globals.set("ANY_ORDER", !!problem.anyOrder);
    const out = JSON.parse(await py.runPythonAsync(HARNESS));
    const passed = out.results.filter((r: any) => r.ok).length;
    return { ...out, passed, total: problem.tests.length };
  }, []);

  return { ready, run };
}
