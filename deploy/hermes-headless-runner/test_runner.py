import importlib.util
import os
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location("runner", ROOT / "runner.py")
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class ContractTest(unittest.TestCase):
    def test_last_result_and_zero_tool_config(self):
        with tempfile.TemporaryDirectory() as root:
            fake = Path(root) / "fake-hermes"
            fake.write_text("""#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
args=sys.argv[1:]
assert args[0]=='--usage-file' and args[2:5]==['chat','--query-file','-']
assert '--resume' not in args and '--continue' not in args
assert '-t' not in args and '--ignore-user-config' not in args
home=Path(os.environ['HERMES_HOME'])
assert 'disabled_toolsets:\\n    - all' in (home/'config.yaml').read_text()
assert os.environ['HOME']==str(home)
assert 'DEEPSEEK_API_KEY' not in os.environ and 'P3_ILINK_CREDENTIAL_KEY' not in os.environ
prompt=sys.stdin.read()
assert '$(touch' in prompt
Path(args[1]).write_text(json.dumps({'cost_status':'unknown','total_including_auxiliary':{'api_calls':2,'total_tokens':36}}))
print(json.dumps({'type':'text','text':'ignore'}))
print(json.dumps({'type':'result','exit_code':0,'text':'old'}))
print(json.dumps({'type':'result','exit_code':0,'text':'final answer'}))
""")
            fake.chmod(0o700)
            runner.HERMES_BIN = str(fake)
            runner.BASE = Path(root) / "state"
            runner.MODEL = "stub-model"
            runner.MODEL_URL = "http://127.0.0.1:8099/v1"
            runner.MODEL_KEY = "fixture-only"
            result1 = runner.run("hello $(touch /tmp/wx-b-should-not-exist)")
            result2 = runner.run("again $(touch /tmp/wx-b-should-not-exist)")
            self.assertEqual(result1["answer"], "final answer")
            self.assertEqual(result2["usage"]["total_including_auxiliary"]["api_calls"], 2)
            self.assertEqual(len(list((runner.BASE / "home").iterdir())), 2)
            self.assertFalse(Path("/tmp/wx-b-should-not-exist").exists())


if __name__ == "__main__":
    unittest.main()
