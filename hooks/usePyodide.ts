"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { problem } from "@/lib/problem";
import type { RunResult } from "@/lib/types";

const CDN = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";

const HARNESS = `
import json, io, sys, traceback
_buf = io.StringIO()
_old = sys.stdout
sys.stdout = _buf
_results, _err = [], None
try:
    _ns = {}
    exec(USER_CODE, _ns)
    _fn = _ns.get(FN_NAME)
    if _fn is None:
        raise NameError("Define a function named " + FN_NAME)
    for _nums, _target, _expected in json.loads(TESTS_JSON):
        _row = {"input": "nums = %s, target = %s" % (_nums, _target), "expected": str(_expected)}
        try:
            _got = _fn(list(_nums), _target)
            _row["got"] = str(_got)
            _row["ok"] = _got is not None and sorted(list(_got)) == sorted(_expected)
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

  const run = useCallback(async (code: string): Promise<RunResult> => {
    const py = pyRef.current;
    py.globals.set("USER_CODE", code);
    py.globals.set("FN_NAME", problem.functionName);
    py.globals.set("TESTS_JSON", JSON.stringify(problem.tests));
    const out = JSON.parse(await py.runPythonAsync(HARNESS));
    const passed = out.results.filter((r: any) => r.ok).length;
    return { ...out, passed, total: problem.tests.length };
  }, []);

  return { ready, run };
}
