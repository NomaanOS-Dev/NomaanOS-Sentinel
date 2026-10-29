import sys
from pathlib import Path

# Add services/agent/src and services/parser/src to sys.path
agent_src = Path(__file__).resolve().parent.parent / "src"
parser_src = Path(__file__).resolve().parent.parent.parent / "parser" / "src"

if str(agent_src) not in sys.path:
    sys.path.insert(0, str(agent_src))

if str(parser_src) not in sys.path:
    sys.path.insert(0, str(parser_src))

