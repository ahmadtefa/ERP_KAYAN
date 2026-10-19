// KAYAN ERP Repair Tool.
//
// A small, self-contained Windows program shipped inside the KAYAN ERP
// installation folder (and linked from the Start menu). It inspects the local
// installation, tells the user what it found, and only changes anything after
// an explicit confirmation. The repair itself is performed by the bundled
// repair-runtime.ps1, which:
//
//   * verifies/installs the bundled Visual C++ runtime,
//   * recovers broken DACLs on kayan.env and the PostgreSQL data directory,
//   * re-registers and starts the KayanERPPostgreSQL service,
//   * applies the checked-in Prisma migrations.
//
// It never deletes, resets or overwrites the database, never changes the
// existing database credentials, and never prints secrets: all output is
// redacted before it is displayed or written to a log.
//
// This file is compiled by build-installer.ps1 with the C# compiler that ships
// with the .NET Framework (csc.exe). Keep the source C# 4 compatible: no string
// interpolation, no null-conditional operator, no expression-bodied members.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace Kayan
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            string root = Path.GetDirectoryName(Application.ExecutablePath);
            bool repair = HasFlag(args, "--repair");
            bool diagnose = HasFlag(args, "--diagnose");
            bool quiet = HasFlag(args, "--quiet");

            if (repair || diagnose)
            {
                return HeadlessRun(root, repair, quiet);
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new RepairForm(root));
            return 0;
        }

        private static bool HasFlag(string[] args, string flag)
        {
            if (args == null) { return false; }
            for (int i = 0; i < args.Length; i++)
            {
                if (string.Equals(args[i], flag, StringComparison.OrdinalIgnoreCase)) { return true; }
            }
            return false;
        }

        // Used by the automated installer smoke test and by support staff who
        // need a scriptable check. Exit code 0 means "no problems detected"
        // (or, with --repair, "no problems remain after the repair attempt").
        private static int HeadlessRun(string root, bool repair, bool quiet)
        {
            List<RepairCheck> before = Diagnostics.Run(root);
            int problemsBefore = CountFailures(before);
            StringBuilder report = new StringBuilder();
            report.AppendLine("Detected problems: " + problemsBefore);
            for (int i = 0; i < before.Count; i++) { report.AppendLine("  " + before[i].ToString()); }

            if (repair && problemsBefore > 0)
            {
                if (!Diagnostics.IsAdministrator())
                {
                    report.AppendLine("Repair attempted: no. This tool must run as Administrator.");
                    RepairLog.Write(root, report.ToString());
                    return 1;
                }
                string output;
                int exitCode = RepairRunner.Run(root, out output);
                report.AppendLine("Repair attempted (exit code " + exitCode + ").");
                if (output.Length > 0) { report.AppendLine(output.TrimEnd()); }
                if (!quiet) { Console.WriteLine(report.ToString()); }
            }
            else if (repair)
            {
                report.AppendLine("Repair attempted: no. Nothing needed repair.");
            }

            List<RepairCheck> after = Diagnostics.Run(root);
            int problemsAfter = CountFailures(after);
            report.AppendLine("Confirmed problems remaining: " + problemsAfter);
            for (int i = 0; i < after.Count; i++) { report.AppendLine("  " + after[i].ToString()); }

            RepairLog.Write(root, report.ToString());
            if (!quiet) { Console.WriteLine(report.ToString()); }
            return problemsAfter == 0 ? 0 : 1;
        }

        internal static int CountFailures(List<RepairCheck> checks)
        {
            int failures = 0;
            for (int i = 0; i < checks.Count; i++)
            {
                if (!checks[i].Ok) { failures++; }
            }
            return failures;
        }
    }

    internal sealed class RepairCheck
    {
        public readonly string Name;
        public readonly bool Ok;
        public readonly string Detail;

        public RepairCheck(string name, bool ok, string detail)
        {
            Name = name;
            Ok = ok;
            Detail = detail == null ? string.Empty : detail;
        }

        public override string ToString()
        {
            string prefix = Ok ? "[OK]   " : "[FAIL] ";
            string suffix = Detail.Length == 0 ? string.Empty : " - " + Detail;
            return prefix + Name + suffix;
        }
    }

    internal static class Diagnostics
    {
        public const string ServiceName = "KayanERPPostgreSQL";

        public static string MachineSettingsPath()
        {
            return Path.Combine(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "KAYAN-ERP"), "kayan.env");
        }

        public static string UserSettingsPath()
        {
            return Path.Combine(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "KAYAN-ERP"), "kayan.env");
        }

        public static string LogsDirectory()
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), Path.Combine("KAYAN-ERP", "logs"));
        }

        public static bool IsAdministrator()
        {
            try
            {
                System.Security.Principal.WindowsIdentity identity = System.Security.Principal.WindowsIdentity.GetCurrent();
                System.Security.Principal.WindowsPrincipal principal = new System.Security.Principal.WindowsPrincipal(identity);
                return principal.IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator);
            }
            catch
            {
                return false;
            }
        }

        public static List<RepairCheck> Run(string root)
        {
            List<RepairCheck> checks = new List<RepairCheck>();

            string repairScript = Path.Combine(root, "repair-runtime.ps1");
            checks.Add(new RepairCheck("Repair script bundled", File.Exists(repairScript), repairScript));

            string machineSettings = MachineSettingsPath();
            string userSettings = UserSettingsPath();
            string settings = null;
            if (File.Exists(machineSettings)) { settings = machineSettings; }
            else if (File.Exists(userSettings)) { settings = userSettings; }
            checks.Add(new RepairCheck(
                "Runtime settings (kayan.env)",
                settings != null,
                settings == null ? "not found; run the KAYAN ERP installer first" : settings));

            string node = Path.Combine(Path.Combine(Path.Combine(root, "backend"), "node"), "node.exe");
            checks.Add(new RepairCheck("Bundled Node.js runtime", File.Exists(node), node));

            string backendDist = Path.Combine(Path.Combine(Path.Combine(root, "backend"), "dist"), "src");
            string mainJs = Path.Combine(backendDist, "main.js");
            checks.Add(new RepairCheck("Backend entry point", File.Exists(mainJs), mainJs));

            string dataDirectory = Path.Combine(Path.Combine(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "KAYAN-ERP"), "PostgreSQL"), "data");
            checks.Add(new RepairCheck(
                "Database cluster present",
                Directory.Exists(dataDirectory) && File.Exists(Path.Combine(dataDirectory, "PG_VERSION")),
                dataDirectory));

            checks.Add(ServiceCheck());
            checks.Add(DatabaseCheck());

            return checks;
        }

        private static RepairCheck ServiceCheck()
        {
            try
            {
                ProcessStartInfo startInfo = new ProcessStartInfo("sc.exe", "query " + ServiceName);
                startInfo.UseShellExecute = false;
                startInfo.CreateNoWindow = true;
                startInfo.RedirectStandardOutput = true;
                startInfo.RedirectStandardError = true;
                using (Process process = Process.Start(startInfo))
                {
                    string output = process.StandardOutput.ReadToEnd();
                    process.StandardError.ReadToEnd();
                    if (!process.WaitForExit(20000))
                    {
                        try { process.Kill(); } catch { }
                        return new RepairCheck("PostgreSQL service (" + ServiceName + ")", false, "sc.exe timed out");
                    }
                    bool running = process.ExitCode == 0 && output.IndexOf("RUNNING", StringComparison.OrdinalIgnoreCase) >= 0;
                    string detail = running ? "running" : (process.ExitCode == 0 ? "installed but not running" : "service is not installed");
                    return new RepairCheck("PostgreSQL service (" + ServiceName + ")", running, detail);
                }
            }
            catch (Exception ex)
            {
                return new RepairCheck("PostgreSQL service (" + ServiceName + ")", false, RepairRunner.Redact(ex.Message));
            }
        }

        private static RepairCheck DatabaseCheck()
        {
            bool reachable = CanConnect("127.0.0.1", 5432, 4000);
            return new RepairCheck("PostgreSQL accepts local connections", reachable, reachable ? "127.0.0.1:5432" : "127.0.0.1:5432 is not accepting connections");
        }

        private static bool CanConnect(string host, int port, int timeoutMilliseconds)
        {
            TcpClient client = new TcpClient();
            try
            {
                IAsyncResult result = client.BeginConnect(host, port, null, null);
                if (!result.AsyncWaitHandle.WaitOne(timeoutMilliseconds)) { return false; }
                client.EndConnect(result);
                return true;
            }
            catch
            {
                return false;
            }
            finally
            {
                try { client.Close(); } catch { }
            }
        }
    }

    internal static class RepairRunner
    {
        // Runs the bundled PowerShell repair script without any interactive
        // prompt (the tool itself already asked for and received confirmation).
        public static int Run(string root, out string output)
        {
            string script = Path.Combine(root, "repair-runtime.ps1");
            if (!File.Exists(script))
            {
                output = "The bundled repair script is missing: " + script;
                return 2;
            }

            ProcessStartInfo startInfo = new ProcessStartInfo("powershell.exe");
            startInfo.Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\" -Quiet";
            startInfo.WorkingDirectory = root;
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = true;
            startInfo.RedirectStandardOutput = true;
            startInfo.RedirectStandardError = true;

            StringBuilder standardOutput = new StringBuilder();
            StringBuilder standardError = new StringBuilder();
            try
            {
                using (Process process = Process.Start(startInfo))
                {
                    process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
                    {
                        if (e.Data != null) { lock (standardOutput) { standardOutput.AppendLine(e.Data); } }
                    };
                    process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
                    {
                        if (e.Data != null) { lock (standardError) { standardError.AppendLine(e.Data); } }
                    };
                    process.BeginOutputReadLine();
                    process.BeginErrorReadLine();

                    if (!process.WaitForExit(900000))
                    {
                        try { process.Kill(); } catch { }
                        output = "The repair did not finish within 15 minutes and was stopped.";
                        return 124;
                    }
                    process.WaitForExit();

                    lock (standardOutput) { lock (standardError) { output = Redact(standardOutput.ToString() + standardError.ToString()).Trim(); } }
                    return process.ExitCode;
                }
            }
            catch (Exception ex)
            {
                output = Redact(ex.Message);
                return 2;
            }
        }

        public static string Redact(string text)
        {
            if (string.IsNullOrEmpty(text)) { return string.Empty; }
            string result = Regex.Replace(text, "(?i)postgres(?:ql)?://[^\\s\"']+", "[DATABASE URL REDACTED]");
            result = Regex.Replace(result, "(?i)(password\\s*[=:]\\s*)[^\\s;]+", "$1[REDACTED]");
            result = Regex.Replace(result, "(?i)(PASSWORD\\s+')[^']+(')", "$1[REDACTED]$2");
            return result;
        }
    }

    internal static class RepairLog
    {
        public static void Write(string root, string text)
        {
            try
            {
                string directory = Diagnostics.LogsDirectory();
                Directory.CreateDirectory(directory);
                string path = Path.Combine(directory, "repairtool.log");
                StringBuilder entry = new StringBuilder();
                entry.AppendLine("==== " + DateTime.UtcNow.ToString("u") + " (UTC) ====");
                entry.AppendLine("Installation: " + root);
                entry.AppendLine("Administrator: " + (Diagnostics.IsAdministrator() ? "yes" : "no"));
                entry.AppendLine(text.TrimEnd());
                File.AppendAllText(path, RepairRunner.Redact(entry.ToString()) + Environment.NewLine);
            }
            catch
            {
                // A log that cannot be written must never hide the result in the UI.
            }
        }
    }

    internal sealed class RepairForm : Form
    {
        private readonly string root;
        private readonly ListBox checks = new ListBox();
        private readonly TextBox log = new TextBox();
        private readonly Label status = new Label();
        private readonly Button repairButton = new Button();
        private string lastAttempt;

        public RepairForm(string installationRoot)
        {
            root = installationRoot;
            Text = "KAYAN ERP Repair Tool";
            Width = 820;
            Height = 640;
            MinimumSize = new Size(680, 500);
            StartPosition = FormStartPosition.CenterScreen;

            Label intro = new Label();
            intro.AutoSize = false;
            intro.Dock = DockStyle.Fill;
            intro.Text = "Inspects and repairs the KAYAN ERP runtime and PostgreSQL service on this computer.\r\n"
                + "It does not delete, reset or overwrite company data, and it does not change existing database credentials.\r\n"
                + "Problems are only reported first; nothing is changed until you select Repair installation.";
            intro.Padding = new Padding(0, 0, 0, 6);

            checks.Dock = DockStyle.Fill;
            checks.IntegralHeight = false;
            checks.Font = new Font("Consolas", 9F);
            checks.HorizontalScrollbar = true;

            status.Dock = DockStyle.Fill;
            status.TextAlign = ContentAlignment.MiddleLeft;
            status.AutoEllipsis = true;
            status.Font = new Font(status.Font, FontStyle.Bold);

            log.Dock = DockStyle.Fill;
            log.Multiline = true;
            log.ReadOnly = true;
            log.ScrollBars = ScrollBars.Both;
            log.WordWrap = false;
            log.Font = new Font("Consolas", 9F);

            FlowLayoutPanel buttons = new FlowLayoutPanel();
            buttons.Dock = DockStyle.Fill;
            buttons.FlowDirection = FlowDirection.RightToLeft;
            buttons.WrapContents = false;
            buttons.Padding = new Padding(0, 10, 0, 0);

            Button closeButton = new Button();
            closeButton.Text = "Close";
            closeButton.Width = 96;
            closeButton.Height = 30;
            closeButton.Click += delegate { Close(); };

            Button logsButton = new Button();
            logsButton.Text = "Open logs folder";
            logsButton.Width = 130;
            logsButton.Height = 30;
            logsButton.Click += delegate { OpenLogs(); };

            Button copyButton = new Button();
            copyButton.Text = "Copy diagnostics";
            copyButton.Width = 130;
            copyButton.Height = 30;
            copyButton.Click += delegate { CopyDiagnostics(); };

            repairButton.Text = "Repair installation";
            repairButton.Width = 150;
            repairButton.Height = 30;
            repairButton.Click += delegate { RunRepair(); };

            buttons.Controls.Add(closeButton);
            buttons.Controls.Add(logsButton);
            buttons.Controls.Add(copyButton);
            buttons.Controls.Add(repairButton);

            TableLayoutPanel layout = new TableLayoutPanel();
            layout.Dock = DockStyle.Fill;
            layout.ColumnCount = 1;
            layout.RowCount = 5;
            layout.Padding = new Padding(14);
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 90F));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 42F));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 44F));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 58F));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 52F));

            layout.Controls.Add(intro, 0, 0);
            layout.Controls.Add(checks, 0, 1);
            layout.Controls.Add(status, 0, 2);
            layout.Controls.Add(log, 0, 3);
            layout.Controls.Add(buttons, 0, 4);
            Controls.Add(layout);

            Load += delegate { RefreshChecks(); };
        }

        private void RefreshChecks()
        {
            List<RepairCheck> results = Diagnostics.Run(root);
            checks.BeginUpdate();
            checks.Items.Clear();
            for (int i = 0; i < results.Count; i++) { checks.Items.Add(results[i]); }
            checks.EndUpdate();

            int failures = Program.CountFailures(results);
            if (lastAttempt == null)
            {
                if (failures == 0)
                {
                    status.Text = "Detected problems: none. The local installation looks healthy.";
                    status.ForeColor = Color.FromArgb(0, 110, 50);
                }
                else
                {
                    status.Text = "Detected problems: " + failures + ". Nothing has been changed yet.";
                    status.ForeColor = Color.FromArgb(170, 60, 0);
                }
            }
            else
            {
                if (failures == 0)
                {
                    status.Text = lastAttempt + " Confirmed: no problems remain.";
                    status.ForeColor = Color.FromArgb(0, 110, 50);
                }
                else
                {
                    status.Text = lastAttempt + " Confirmed problems remaining: " + failures + ". See the log below.";
                    status.ForeColor = Color.FromArgb(170, 60, 0);
                }
            }
            repairButton.Enabled = failures > 0;
        }

        private void RunRepair()
        {
            if (!Diagnostics.IsAdministrator())
            {
                MessageBox.Show(this,
                    "Repairing requires Administrator rights. Close this window and start RepairTool.exe by right-clicking it and choosing 'Run as administrator'.",
                    "KAYAN ERP Repair", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            DialogResult answer = MessageBox.Show(this,
                "This will stop the running KAYAN ERP program, verify the bundled runtime, repair file permissions, restart the local PostgreSQL service and apply any pending database migrations.\r\n\r\n"
                + "It does not delete, reset or overwrite company data, and it does not change existing database credentials.\r\n\r\n"
                + "Continue with the repair?",
                "KAYAN ERP Repair", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2);
            if (answer != DialogResult.Yes) { return; }

            repairButton.Enabled = false;
            status.Text = "Repair in progress. This can take several minutes...";
            status.ForeColor = Color.FromArgb(40, 60, 120);
            status.Refresh();
            Application.DoEvents();

            string output;
            int exitCode = RepairRunner.Run(root, out output);
            lastAttempt = "Repair attempted (exit code " + exitCode + ").";

            StringBuilder entry = new StringBuilder();
            entry.AppendLine("---- " + DateTime.Now.ToString("u") + " repair attempt (exit code " + exitCode + ") ----");
            if (output.Length > 0) { entry.AppendLine(output); }
            if (log.TextLength > 0) { log.AppendText(Environment.NewLine); }
            log.AppendText(entry.ToString());
            RepairLog.Write(root, entry.ToString());

            RefreshChecks();
        }

        private void CopyDiagnostics()
        {
            try
            {
                StringBuilder builder = new StringBuilder();
                for (int i = 0; i < checks.Items.Count; i++) { builder.AppendLine(checks.Items[i].ToString()); }
                builder.AppendLine();
                builder.AppendLine(status.Text);
                if (log.TextLength > 0) { builder.AppendLine(); builder.AppendLine(RepairRunner.Redact(log.Text)); }
                Clipboard.SetText(builder.ToString());
                MessageBox.Show(this, "Diagnostics were copied to the clipboard.", "KAYAN ERP Repair", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "Could not copy the diagnostics: " + RepairRunner.Redact(ex.Message), "KAYAN ERP Repair", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void OpenLogs()
        {
            try
            {
                string directory = Diagnostics.LogsDirectory();
                Directory.CreateDirectory(directory);
                Process.Start(new ProcessStartInfo("explorer.exe", "\"" + directory + "\""));
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "Could not open the logs folder: " + RepairRunner.Redact(ex.Message), "KAYAN ERP Repair", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }
    }
}
