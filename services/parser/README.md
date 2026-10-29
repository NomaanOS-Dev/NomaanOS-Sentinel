# Sentinel Parser Package

The `sentinel_parser` package provides deterministic, high-performance parsing of standard Linux authentication logs (`/var/log/auth.log` and `/var/log/secure`) into the canonical NomaanOS Sentinel security event schema.

---

## Features

- **Strict Schema Alignment**: Outputs conform to `database/schema/security-event.schema.json`.
- **Fault-Tolerant Processing**: Invalid or malformed log lines do not crash the engine; unparseable lines are counted and isolated in the parse summary.
- **Untrusted Input Safety**: All log content is treated as untrusted text. No shell execution, eval, or dangerous reflection is used.
- **Source Line Traceability**: Retains `evidence.raw_line` and `evidence.line_number` for analyst auditing.

---

## Usage

### Self-Check Command
```bash
python -m sentinel_parser.cli --self-check
```

### Parsing a File
```bash
python -m sentinel_parser.cli parse /path/to/auth.log
```

### Programmatic API
```python
from sentinel_parser import parse_line, parse_file

# Parse single line
event = parse_line("Oct 24 10:14:22 bastion-01 sshd[14201]: Accepted publickey for deploy from 192.0.2.10 port 49152 ssh2")
if event:
    print(event.to_dict())

# Parse file
summary = parse_file("fixtures/linux-auth/mixed-activity.log")
print(f"Parsed {summary.valid_count} events ({summary.malformed_count} malformed)")
```

