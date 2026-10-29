"""Unit tests for sentinel_parser LinuxAuthParser."""

import os
import unittest
from sentinel_parser.parser import LinuxAuthParser, parse_line, parse_lines
from sentinel_parser.models import EventType, SeverityLevel


class TestLinuxAuthParser(unittest.TestCase):
    def setUp(self):
        self.parser = LinuxAuthParser(default_year=2026)
        self.fixtures_dir = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "../../../fixtures/linux-auth")
        )

    def test_parse_ssh_success_fixture(self):
        filepath = os.path.join(self.fixtures_dir, "ssh-success.log")
        summary = self.parser.parse_file(filepath)

        self.assertEqual(summary.total_lines, 4)
        self.assertEqual(summary.valid_count, 4)
        self.assertEqual(summary.malformed_count, 0)

        first_event = summary.events[0]
        self.assertEqual(first_event.event_type, EventType.SSH_LOGIN_SUCCESS.value)
        self.assertEqual(first_event.username, "deploy")
        self.assertEqual(first_event.source_ip, "192.0.2.10")
        self.assertEqual(first_event.source_port, 49152)
        self.assertEqual(first_event.severity, SeverityLevel.INFO.value)

    def test_parse_ssh_failure_fixture(self):
        filepath = os.path.join(self.fixtures_dir, "ssh-failure.log")
        summary = self.parser.parse_file(filepath)

        self.assertEqual(summary.total_lines, 4)
        self.assertGreaterEqual(summary.valid_count, 3)

        # First line is invalid user
        self.assertEqual(summary.events[0].event_type, EventType.INVALID_USER_ATTEMPT.value)
        self.assertEqual(summary.events[0].username, "root")
        self.assertEqual(summary.events[0].source_ip, "192.0.2.100")

        # Second line is analyst failure
        self.assertEqual(summary.events[1].event_type, EventType.SSH_LOGIN_FAILURE.value)
        self.assertEqual(summary.events[1].username, "analyst")
        self.assertEqual(summary.events[1].source_ip, "198.51.100.5")

    def test_parse_invalid_user_fixture(self):
        filepath = os.path.join(self.fixtures_dir, "invalid-user.log")
        summary = self.parser.parse_file(filepath)

        self.assertEqual(summary.total_lines, 6)
        self.assertEqual(summary.valid_count, 6)
        for event in summary.events:
            self.assertEqual(event.event_type, EventType.INVALID_USER_ATTEMPT.value)
            self.assertEqual(event.severity, SeverityLevel.MEDIUM.value)
            self.assertEqual(event.source_ip, "203.0.113.50")

    def test_parse_sudo_activity_fixture(self):
        filepath = os.path.join(self.fixtures_dir, "sudo-activity.log")
        summary = self.parser.parse_file(filepath)

        self.assertEqual(summary.total_lines, 4)
        # Sudo execution
        exec_event = summary.events[0]
        self.assertEqual(exec_event.event_type, EventType.SUDO_EXECUTION.value)
        self.assertEqual(exec_event.username, "deploy")
        self.assertIn("systemctl restart nginx", exec_event.evidence.get("command", ""))

        # Sudo failure
        fail_event = summary.events[3]
        self.assertEqual(fail_event.event_type, EventType.PRIVILEGE_ESCALATION_FAILURE.value)
        self.assertEqual(fail_event.username, "analyst")
        self.assertEqual(fail_event.severity, SeverityLevel.HIGH.value)

    def test_malformed_lines_handling_without_crash(self):
        filepath = os.path.join(self.fixtures_dir, "malformed-lines.log")
        summary = self.parser.parse_file(filepath)

        # Must not raise exceptions, and identify malformed lines
        self.assertGreater(summary.malformed_count, 0)
        self.assertEqual(summary.total_lines, 7)

    def test_untrusted_input_adversarial_strings(self):
        """Ensure malicious shell injections in log messages are not executed or parsed unsafely."""
        payload = "Oct 24 10:14:22 bastion-01 sshd[123]: Failed password for invalid user `rm -rf /` from 192.0.2.1 port 22 ssh2"
        event = parse_line(payload)
        self.assertIsNotNone(event)
        self.assertEqual(event.username, "`rm -rf /`")
        self.assertEqual(event.source_ip, "192.0.2.1")
        self.assertEqual(event.validate(), [])

    def test_normal_records_with_trailing_newline(self):
        lines = [
            "Oct 24 10:14:22 bastion-01 sshd[14201]: Accepted publickey for deploy from 192.0.2.10 port 49152 ssh2: RSA SHA256:abc\n",
            "Oct 24 10:15:01 bastion-01 sshd[14205]: pam_unix(sshd:session): session opened for user deploy(uid=1001) by (uid=0)\n",
        ]
        summary = self.parser.parse_lines(lines)
        self.assertEqual(summary.total_lines, 2)
        self.assertEqual(summary.valid_count, 2)
        self.assertEqual(summary.malformed_count, 0)
        self.assertEqual(len(summary.events), 2)
        self.assertEqual(summary.events[0].evidence["line_number"], 1)
        self.assertEqual(summary.events[1].evidence["line_number"], 2)

    def test_trailing_blank_line(self):
        lines = [
            "Oct 24 10:14:22 bastion-01 sshd[14201]: Accepted publickey for deploy from 192.0.2.10 port 49152 ssh2\n",
            "\n",
        ]
        summary = self.parser.parse_lines(lines)
        self.assertEqual(summary.total_lines, 1)
        self.assertEqual(summary.valid_count, 1)
        self.assertEqual(summary.malformed_count, 0)

    def test_multiple_blank_and_whitespace_only_lines(self):
        lines = [
            "\n",
            "   \t  \n",
            "Oct 24 10:14:22 bastion-01 sshd[14201]: Accepted publickey for deploy from 192.0.2.10 port 49152 ssh2\n",
            "    \n",
            "\n",
        ]
        summary = self.parser.parse_lines(lines)
        self.assertEqual(summary.total_lines, 1)
        self.assertEqual(summary.valid_count, 1)
        self.assertEqual(summary.malformed_count, 0)
        self.assertEqual(summary.events[0].evidence["line_number"], 3)

    def test_empty_file_or_lines(self):
        summary = self.parser.parse_lines([])
        self.assertEqual(summary.total_lines, 0)
        self.assertEqual(summary.valid_count, 0)
        self.assertEqual(summary.malformed_count, 0)
        self.assertEqual(summary.events, [])

    def test_malformed_nonblank_records(self):
        lines = [
            "Garbage line that cannot be parsed as syslog\n",
            "Oct 24 99:99:99 bad timestamp sshd[1]: invalid\n",
        ]
        summary = self.parser.parse_lines(lines)
        self.assertEqual(summary.total_lines, 2)
        self.assertEqual(summary.valid_count, 0)
        self.assertEqual(summary.malformed_count, 2)
        self.assertEqual(summary.events, [])

    def test_physical_line_numbers_accurate_across_blank_lines(self):
        lines = [
            "Oct 24 10:14:22 bastion-01 sshd[14201]: Accepted publickey for deploy from 192.0.2.10 port 49152 ssh2\n",
            "\n",
            "\r\n",
            "   \n",
            "Oct 24 10:15:01 bastion-01 sshd[14205]: pam_unix(sshd:session): session opened for user deploy\n",
            "\n",
            "Oct 24 10:20:11 bastion-01 sshd[14301]: Failed password for invalid user root from 192.0.2.100 port 38291 ssh2\n",
        ]
        summary = self.parser.parse_lines(lines)
        self.assertEqual(summary.total_lines, 3)
        self.assertEqual(summary.valid_count, 3)
        self.assertEqual(summary.malformed_count, 0)
        self.assertEqual(summary.events[0].evidence["line_number"], 1)
        self.assertEqual(summary.events[1].evidence["line_number"], 5)
        self.assertEqual(summary.events[2].evidence["line_number"], 7)

    # -------------------------------------------------------------
    # 20 Canonical Test Scenarios
    # -------------------------------------------------------------

    def test_scenario_01_successful_password_auth(self):
        line = "Oct 24 10:14:22 bastion sshd[14201]: Accepted password for deploy from 192.0.2.10 port 49152 ssh2"
        event = parse_line(line)
        self.assertIsNotNone(event)
        self.assertEqual(event.event_type, EventType.SSH_LOGIN_SUCCESS.value)
        self.assertEqual(event.username, "deploy")
        self.assertEqual(event.source_ip, "192.0.2.10")
        self.assertEqual(event.source_port, 49152)
        self.assertEqual(event.evidence.get("auth_method"), "password")

    def test_scenario_02_successful_publickey_auth(self):
        line = "Oct 24 10:14:22 bastion sshd[14201]: Accepted publickey for deploy from 192.0.2.10 port 49152 ssh2: RSA SHA256:abc"
        event = parse_line(line)
        self.assertIsNotNone(event)
        self.assertEqual(event.event_type, EventType.SSH_LOGIN_SUCCESS.value)
        self.assertEqual(event.evidence.get("auth_method"), "publickey")

    def test_scenario_03_failed_password_auth(self):
        line = "Oct 24 10:20:15 bastion sshd[14305]: Failed password for analyst from 198.51.100.5 port 51230 ssh2"
        event = parse_line(line)
        self.assertIsNotNone(event)
        self.assertEqual(event.event_type, EventType.SSH_LOGIN_FAILURE.value)
        self.assertEqual(event.username, "analyst")
        self.assertEqual(event.severity, SeverityLevel.LOW.value)

    def test_scenario_04_invalid_user_attempt(self):
        line = "Oct 24 10:20:11 bastion sshd[14301]: Failed password for invalid user root from 192.0.2.100 port 38291 ssh2"
        event = parse_line(line)
        self.assertIsNotNone(event)
        self.assertEqual(event.event_type, EventType.INVALID_USER_ATTEMPT.value)
        self.assertEqual(event.username, "root")
        self.assertEqual(event.severity, SeverityLevel.MEDIUM.value)

    def test_scenario_05_missing_optional_fields(self):
        line = "Oct 24 11:40:01 bastion sudo: pam_unix(sudo:session): session opened for user root(uid=0) by deploy"
        event = parse_line(line)
        self.assertIsNotNone(event)
        self.assertEqual(event.event_type, EventType.SESSION_OPENED.value)
        self.assertIsNone(event.evidence.get("process_id"))
        self.assertIsNone(event.source_ip)
        self.assertIsNone(event.source_port)

    def test_scenario_06_ipv4_source_address(self):
        line = "Oct 24 10:14:22 bastion sshd[14201]: Accepted publickey for deploy from 192.0.2.10 port 49152 ssh2"
        event = parse_line(line)
        self.assertIsNotNone(event)
        self.assertEqual(event.source_ip, "192.0.2.10")

    def test_scenario_07_ipv6_source_address(self):
        line = "Oct 24 10:14:22 bastion sshd[14201]: Accepted publickey for deploy from 2001:db8:85a3::8a2e:370:7334 port 49152 ssh2"
        event = parse_line(line)
        self.assertIsNotNone(event)
        self.assertEqual(event.source_ip, "2001:db8:85a3::8a2e:370:7334")
        self.assertEqual(event.validate(), [])

    def test_scenario_08_known_timezone_normalization(self):
        line = "2026-10-24T15:14:22+05:00 bastion-01 sshd[14201]: Accepted password for deploy from 192.0.2.10 port 22 ssh2"
        event = parse_line(line)
        self.assertIsNotNone(event)
        self.assertEqual(event.occurred_at, "2026-10-24T10:14:22+00:00")
        self.assertFalse(event.evidence.get("timestamp_uncertain", True))

    def test_scenario_09_unknown_timezone(self):
        line = "Oct 24 10:14:22 bastion-01 sshd[14201]: Accepted password for deploy from 192.0.2.10 port 22 ssh2"
        event = parse_line(line)
        self.assertIsNotNone(event)
        self.assertTrue(event.evidence.get("timestamp_uncertain"))
        self.assertTrue(event.evidence.get("inferred_timezone"))
        self.assertIn("UTC", event.evidence.get("timezone_assumption", ""))

    def test_scenario_10_missing_year(self):
        line = "Oct 24 10:14:22 bastion-01 sshd[14201]: Accepted password for deploy from 192.0.2.10 port 22 ssh2"
        parser = LinuxAuthParser(default_year=2026)
        event = parser.parse_line(line)
        self.assertIsNotNone(event)
        self.assertEqual(event.evidence.get("inferred_year"), 2026)
        self.assertTrue(event.occurred_at.startswith("2026-10-24"))

    def test_scenario_11_malformed_timestamp(self):
        line = "Oct 24 99:99:99 bastion-01 sshd[14201]: Accepted password for deploy from 192.0.2.10 port 22 ssh2"
        event = parse_line(line)
        self.assertIsNone(event)

    def test_scenario_12_impossible_timestamp(self):
        line_feb30 = "Feb 30 10:14:22 bastion-01 sshd[14201]: Accepted password for deploy from 192.0.2.10 port 22 ssh2"
        line_oct32 = "Oct 32 10:14:22 bastion-01 sshd[14201]: Accepted password for deploy from 192.0.2.10 port 22 ssh2"
        self.assertIsNone(parse_line(line_feb30))
        self.assertIsNone(parse_line(line_oct32))

    def test_scenario_13_unsupported_log_format(self):
        apache_line = '192.0.2.1 - - [24/Oct/2026:10:14:22 +0000] "GET / HTTP/1.1" 200 1234'
        cron_line = "Oct 24 10:14:22 bastion-01 CRON[9999]: (root) CMD (/usr/bin/backup.sh)"
        summary = parse_lines([apache_line, cron_line])
        self.assertEqual(summary.valid_count, 0)
        self.assertEqual(summary.unsupported_count, 2)
        self.assertEqual(summary.malformed_count, 0)

    def test_scenario_14_empty_input(self):
        summary = parse_lines([])
        self.assertEqual(summary.total_lines, 0)
        self.assertEqual(summary.valid_count, 0)
        self.assertEqual(summary.malformed_count, 0)
        self.assertEqual(summary.skipped_count, 0)

    def test_scenario_15_invalid_encoding(self):
        line = "Oct 24 10:14:22 bastion-01 sshd[14201]: Failed password for user \ufffd\ufffd from 192.0.2.10 port 22 ssh2"
        event = parse_line(line)
        self.assertIsNotNone(event)
        self.assertEqual(event.validate(), [])

    def test_scenario_16_extremely_long_lines(self):
        huge_user = "A" * 6000
        line = f"Oct 24 10:14:22 bastion-01 sshd[14201]: Failed password for {huge_user} from 192.0.2.10 port 22 ssh2"
        summary = parse_lines([line])
        self.assertEqual(summary.total_lines, 1)
        if summary.events:
            self.assertLessEqual(len(summary.events[0].message), 2048)

    def test_scenario_17_adversarial_input(self):
        payloads = [
            "$(cat /etc/passwd)",
            "; DROP TABLE users; --",
            "../../../../etc/shadow",
            "<script>alert(1)</script>",
        ]
        for p in payloads:
            line = f"Oct 24 10:14:22 bastion sshd[14201]: Failed password for {p} from 192.0.2.10 port 22 ssh2"
            event = parse_line(line)
            self.assertIsNotNone(event)
            self.assertEqual(event.username, p)

    def test_scenario_18_correct_source_line_references(self):
        lines = [
            "Oct 24 10:14:22 bastion sshd[14201]: Accepted publickey for deploy from 192.0.2.10 port 49152 ssh2\n",
            "\n",
            "\n",
            "Oct 24 10:15:01 bastion sudo[14205]: deploy : COMMAND=/bin/ls\n",
        ]
        summary = parse_lines(lines)
        self.assertEqual(summary.events[0].evidence["line_number"], 1)
        self.assertEqual(summary.events[1].evidence["line_number"], 4)

    def test_scenario_19_correct_classification_counts(self):
        lines = [
            "\n",
            "Oct 24 10:14:22 bastion sshd[14201]: Accepted publickey for deploy from 192.0.2.10 port 49152 ssh2\n",
            "Garbage line that cannot be parsed\n",
            "Oct 24 10:14:22 bastion CRON[123]: (root) CMD (/backup)\n",
            "   \n",
        ]
        summary = parse_lines(lines)
        self.assertEqual(summary.total_lines, 3)
        self.assertEqual(summary.valid_count, 1)
        self.assertEqual(summary.malformed_count, 1)
        self.assertEqual(summary.unsupported_count, 1)
        self.assertEqual(summary.skipped_count, 2)
        self.assertEqual(summary.total_lines, summary.valid_count + summary.malformed_count + summary.unsupported_count)

    def test_scenario_20_stable_parser_output_for_identical_input(self):
        fixture = "Oct 24 10:14:22 bastion sshd[14201]: Accepted publickey for deploy from 192.0.2.10 port 49152 ssh2"
        parser = LinuxAuthParser(default_year=2026)
        res1 = parser.parse_line(fixture)
        res2 = parser.parse_line(fixture)
        self.assertEqual(res1.occurred_at, res2.occurred_at)
        self.assertEqual(res1.username, res2.username)
        self.assertEqual(res1.source_ip, res2.source_ip)
        self.assertEqual(res1.source_port, res2.source_port)
        self.assertEqual(res1.event_type, res2.event_type)
        self.assertEqual(res1.severity, res2.severity)
        self.assertEqual(res1.evidence["raw_timestamp"], res2.evidence["raw_timestamp"])


if __name__ == "__main__":
    unittest.main()
