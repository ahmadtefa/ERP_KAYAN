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
//   * applies the checked-in Prisma migrations, and
//   * proves the repair by briefly starting the real API and requiring a
//     healthy answer from it before declaring success.
//
// The diagnostics below deliberately separate the five ways a desktop
// installation can be unwell - server down, database down, settings wrong,
// migrations pending, first-run setup not finished - because "the program
// says it cannot reach the server" has a different fix for each. The
// configured database port is read from kayan.env instead of being assumed,
// and the API is probed on the shell's own candidate ports.
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
using System.Net;
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
                if (exitCode != 0)
                {
                    // The repair script says it did not finish. Diagnostics
                    // happening to look clean afterwards is not a repair: it
                    // can be clean because the script got as far as restarting
                    // the service and then failed. Reporting 0 here made a
                    // failed repair indistinguishable from a successful one.
                    report.AppendLine("The repair did not complete; its own exit code was " + exitCode + ".");
                    RepairLog.Write(root, report.ToString());
                    if (!quiet) { Console.WriteLine(report.ToString()); }
                    return exitCode == 0 ? 1 : exitCode;
                }
            }
            else if (repair)
            {
                report.AppendLine("Repair attempted: no. Nothing needed repair.");
            }

            List<RepairCheck> after = Diagnostics.Run(root);
            int problemsAfter = CountFailures(after);
            report.AppendLine("Confirmed problems remaining: " + problemsAfter);
            for (int i = 0; i < after.Count; i++) { report.AppendLine("  " + after[i].ToString()); }
            report.AppendLine(Diagnostics.Diagnose(after));

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

        // Check names the diagnosis summary looks up. Keep them stable:
        // Diagnose() and the CI smoke test reason about these strings.
        internal const string CheckSettings = "Runtime settings (kayan.env)";
        internal const string CheckDatabasePort = "PostgreSQL accepts local connections";
        internal const string CheckApi = "Local API (starts with the program)";
        internal const string CheckLog = "Last server log";

        public static List<RepairCheck> Run(string root)
        {
            List<RepairCheck> checks = new List<RepairCheck>();

            string repairScript = Path.Combine(root, "repair-runtime.ps1");
            checks.Add(new RepairCheck("Repair script bundled", File.Exists(repairScript), repairScript));

            string programExe = Path.Combine(root, "erp_kayan.exe");
            checks.Add(new RepairCheck("Program executable", File.Exists(programExe), programExe));

            // The settings file decides where the database is, so it is
            // read (never displayed) before anything probes a port: the
            // database port is the CONFIGURED one, not an assumed 5432.
            string machineSettings = MachineSettingsPath();
            string userSettings = UserSettingsPath();
            string settings = null;
            if (File.Exists(machineSettings)) { settings = machineSettings; }
            else if (File.Exists(userSettings)) { settings = userSettings; }
            checks.Add(new RepairCheck(
                CheckSettings,
                settings != null,
                settings == null ? "not found; run the KAYAN ERP installer first" : settings));

            Dictionary<string, string> values = ReadSettings(settings);
            checks.Add(SettingsContentCheck(settings, values));
            int databasePort = ConfiguredDatabasePort(values);
            string databaseHost = ConfiguredDatabaseHost(values);

            string node = Path.Combine(Path.Combine(Path.Combine(root, "backend"), "node"), "node.exe");
            checks.Add(RuntimeCheck("Bundled Node.js runtime", node, "--version"));

            string backendDist = Path.Combine(Path.Combine(Path.Combine(root, "backend"), "dist"), "src");
            string mainJs = Path.Combine(backendDist, "main.js");
            checks.Add(new RepairCheck("Backend entry point", File.Exists(mainJs), mainJs));

            // Without these two the first run cannot create the company or
            // its first administrator, which looks exactly like "the
            // program never gets past start-up".
            string prepareScript = Path.Combine(Path.Combine(Path.Combine(root, "backend"), "scripts"), "prepare-database.mjs");
            checks.Add(new RepairCheck("Database preparation script", File.Exists(prepareScript), prepareScript));
            string seedScript = Path.Combine(Path.Combine(Path.Combine(Path.Combine(root, "backend"), "dist"), "prisma"), "seed.js");
            checks.Add(new RepairCheck("First-run setup program", File.Exists(seedScript), seedScript));
            string pgBin = Path.Combine(Path.Combine(Path.Combine(root, "backend"), "postgres"), "bin");
            string pgIsReady = Path.Combine(pgBin, "pg_isready.exe");
            string[] pgRequired = new string[] { "initdb.exe", "pg_ctl.exe", "pg_isready.exe", "psql.exe", "postgres.exe" };
            bool pgFilesPresent = true;
            for (int i = 0; i < pgRequired.Length; i++)
            {
                if (!File.Exists(Path.Combine(pgBin, pgRequired[i]))) { pgFilesPresent = false; }
            }
            RepairCheck pgExecutable = RuntimeCheck("Bundled PostgreSQL executable", pgIsReady, "--version");
            checks.Add(new RepairCheck(
                "Bundled PostgreSQL tools",
                pgFilesPresent && pgExecutable.Ok,
                pgFilesPresent ? pgExecutable.Detail : "one or more required PostgreSQL executables are missing from " + pgBin));

            string dataDirectory = Path.Combine(Path.Combine(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "KAYAN-ERP"), "PostgreSQL"), "data");
            checks.Add(new RepairCheck(
                "Database cluster present",
                Directory.Exists(dataDirectory) && File.Exists(Path.Combine(dataDirectory, "PG_VERSION")),
                dataDirectory));

            checks.Add(ServiceCheck());
            checks.Add(DatabaseCheck(databaseHost, databasePort));
            checks.Add(ApiCheck());
            checks.Add(LogCheck());

            return checks;
        }

        // kayan.env, parsed the same tolerant way the shell and the
        // PowerShell tooling parse it. Values stay inside this process;
        // only redacted shapes (user@host:port/database, yes/no) are
        // ever reported.
        internal static Dictionary<string, string> ReadSettings(string settingsPath)
        {
            Dictionary<string, string> values = new Dictionary<string, string>();
            if (settingsPath == null) { return values; }
            try
            {
                string[] lines = File.ReadAllLines(settingsPath);
                Regex pattern = new Regex("^\\s*([A-Z_]+)=\"?(.*?)\"?\\s*$");
                for (int i = 0; i < lines.Length; i++)
                {
                    Match match = pattern.Match(lines[i].TrimStart('﻿'));
                    if (match.Success)
                    {
                        values[match.Groups[1].Value] = match.Groups[2].Value.Trim('"');
                    }
                }
            }
            catch
            {
                // An unreadable settings file is exactly the kind of
                // problem the checks below must report, not throw on.
            }
            return values;
        }

        private static RepairCheck SettingsContentCheck(string settingsPath, Dictionary<string, string> values)
        {
            const string name = "Settings point at a database";
            if (settingsPath == null)
            {
                return new RepairCheck(name, false, "no settings file to read");
            }
            string databaseUrl;
            if (!values.TryGetValue("DATABASE_URL", out databaseUrl) || string.IsNullOrEmpty(databaseUrl))
            {
                return new RepairCheck(name, false, "DATABASE_URL is missing from " + settingsPath);
            }
            Uri uri;
            if (!Uri.TryCreate(databaseUrl, UriKind.Absolute, out uri) || string.IsNullOrEmpty(uri.Host))
            {
                return new RepairCheck(name, false, "DATABASE_URL is not a readable address");
            }
            string user = "user";
            if (!string.IsNullOrEmpty(uri.UserInfo))
            {
                int colon = uri.UserInfo.IndexOf(':');
                user = colon >= 0 ? uri.UserInfo.Substring(0, colon) : uri.UserInfo;
            }
            string database = uri.AbsolutePath.TrimStart('/');
            string admin = values.ContainsKey("ADMIN_DATABASE_URL") && !string.IsNullOrEmpty(values["ADMIN_DATABASE_URL"])
                ? "admin settings present" : "no admin settings (direct app login must work)";
            return new RepairCheck(name, true, user + "@" + uri.Host + ":" + ConfiguredPort(uri) + "/" + database + "; " + admin);
        }

        private static int ConfiguredPort(Uri uri)
        {
            return uri.Port > 0 ? uri.Port : 5432;
        }

        private static int ConfiguredDatabasePort(Dictionary<string, string> values)
        {
            string databaseUrl;
            Uri uri;
            if (values.TryGetValue("DATABASE_URL", out databaseUrl)
                && Uri.TryCreate(databaseUrl, UriKind.Absolute, out uri))
            {
                return ConfiguredPort(uri);
            }
            return 5432;
        }

        private static string ConfiguredDatabaseHost(Dictionary<string, string> values)
        {
            string databaseUrl;
            Uri uri;
            if (values.TryGetValue("DATABASE_URL", out databaseUrl)
                && Uri.TryCreate(databaseUrl, UriKind.Absolute, out uri)
                && !string.IsNullOrEmpty(uri.Host))
            {
                return uri.Host;
            }
            return "127.0.0.1";
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

        // File presence is not proof that a native runtime can load on a clean
        // Windows machine. Execute its harmless version command so missing
        // VC++ DLLs, damaged binaries and architecture mismatches are visible.
        private static RepairCheck RuntimeCheck(string name, string executable, string arguments)
        {
            if (!File.Exists(executable))
            {
                return new RepairCheck(name, false, "missing: " + executable);
            }
            try
            {
                ProcessStartInfo info = new ProcessStartInfo(executable, arguments);
                info.UseShellExecute = false;
                info.CreateNoWindow = true;
                info.RedirectStandardOutput = true;
                info.RedirectStandardError = true;
                using (Process process = Process.Start(info))
                {
                    if (!process.WaitForExit(15000))
                    {
                        try { process.Kill(); } catch { }
                        return new RepairCheck(name, false, "version check timed out: " + executable);
                    }
                    string output = (process.StandardOutput.ReadToEnd() + " " + process.StandardError.ReadToEnd()).Trim();
                    if (process.ExitCode != 0)
                    {
                        return new RepairCheck(name, false, "cannot execute (exit " + process.ExitCode + "): " + RepairRunner.Redact(output));
                    }
                    return new RepairCheck(name, true, output.Length == 0 ? executable : output);
                }
            }
            catch (Exception ex)
            {
                return new RepairCheck(name, false, "cannot load or start: " + RepairRunner.Redact(ex.Message));
            }
        }

        private static RepairCheck DatabaseCheck(string host, int port)
        {
            bool reachable = CanConnect(host, port, 4000);
            return new RepairCheck(
                CheckDatabasePort,
                reachable,
                reachable ? host + ":" + port : host + ":" + port + " (the configured port) is not accepting connections");
        }

        // The server only runs while the program is open, so "not
        // running" is information, not a failure. What this probe adds:
        // when it IS running, it says whether first-run setup still
        // waits (needsSetup) - the state that stranded real users at a
        // "cannot reach the server" message when the shell had not
        // started any server yet - and whether something that is not
        // KAYAN occupies one of the shell's ports.
        private static RepairCheck ApiCheck()
        {
            int[] ports = new int[] { 3000, 3001, 3002, 3003, 3010, 3020 };
            for (int i = 0; i < ports.Length; i++)
            {
                string body = TryGetHealth(ports[i]);
                if (body == null) { continue; }
                if (body.IndexOf("\"status\"", StringComparison.Ordinal) < 0)
                {
                    return new RepairCheck(
                        CheckApi,
                        false,
                        "port " + ports[i] + " answers, but not like the KAYAN API - another program may be using it");
                }
                bool needsSetup = body.IndexOf("\"needsSetup\":true", StringComparison.Ordinal) >= 0
                    || body.IndexOf("\"needsSetup\": true", StringComparison.Ordinal) >= 0;
                return new RepairCheck(
                    CheckApi,
                    true,
                    needsSetup
                        ? "running on port " + ports[i] + "; FIRST-RUN SETUP NOT COMPLETED - open KAYAN ERP and create the company and first administrator"
                        : "running and healthy on port " + ports[i]);
            }
            return new RepairCheck(
                CheckApi,
                true,
                "not running right now; it starts automatically when KAYAN ERP opens");
        }

        private static string TryGetHealth(int port)
        {
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/api/v1/health");
                request.Timeout = 2000;
                request.ReadWriteTimeout = 2000;
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                {
                    if ((int)response.StatusCode != 200) { return null; }
                    using (StreamReader reader = new StreamReader(response.GetResponseStream()))
                    {
                        return reader.ReadToEnd();
                    }
                }
            }
            catch
            {
                return null;
            }
        }

        // The desktop shell's log, scanned for the signatures that name
        // the failure in words. Informational by design (it never makes
        // the verdict worse); the newest recognised condition wins.
        private static RepairCheck LogCheck()
        {
            string logPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                Path.Combine("KAYAN-ERP", Path.Combine("logs", "backend.log")));
            try
            {
                if (!File.Exists(logPath))
                {
                    return new RepairCheck(CheckLog, true, "no server log yet (" + logPath + ")");
                }
                string[] lines = File.ReadAllLines(logPath);
                int from = Math.Max(0, lines.Length - 120);
                string diagnosis = null;
                for (int i = from; i < lines.Length; i++)
                {
                    string line = lines[i];
                    if (line.IndexOf("asking who the first administrator is", StringComparison.Ordinal) >= 0)
                    {
                        diagnosis = "the last run stopped at first-run setup: the database is ready and empty, waiting for the company and first administrator to be created in the program";
                    }
                    else if (line.IndexOf("P1000", StringComparison.Ordinal) >= 0
                        || line.IndexOf("password authentication failed", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        diagnosis = "the database rejected the saved credentials (authentication) - check kayan.env, do not reinstall over the data";
                    }
                    else if (line.IndexOf("P1001", StringComparison.Ordinal) >= 0
                        || line.IndexOf("ECONNREFUSED", StringComparison.Ordinal) >= 0)
                    {
                        diagnosis = "the server could not reach the database (connection refused) - PostgreSQL service or port problem";
                    }
                    else if (line.IndexOf("DATABASE_URL is not set", StringComparison.Ordinal) >= 0)
                    {
                        diagnosis = "the server was started without its settings (DATABASE_URL missing) - it must be started by the KAYAN ERP program, which loads kayan.env for it";
                    }
                    else if (line.IndexOf("migrations: failed", StringComparison.Ordinal) >= 0)
                    {
                        diagnosis = "database preparation failed during migrations - see the [prep] lines above this one in the log";
                    }
                    else if (line.IndexOf("the server exited with code", StringComparison.Ordinal) >= 0)
                    {
                        diagnosis = "the last server process exited early - see the [err] lines just above it in the log";
                    }
                }
                bool failed = diagnosis != null
                    && diagnosis.IndexOf("first-run setup", StringComparison.OrdinalIgnoreCase) < 0;
                return new RepairCheck(
                    CheckLog,
                    !failed,
                    diagnosis ?? "no known failure signature in the last log lines");
            }
            catch (Exception ex)
            {
                return new RepairCheck(CheckLog, true, "could not read the server log: " + RepairRunner.Redact(ex.Message));
            }
        }

        // One sentence a person can act on, naming WHICH of the five
        // failure families this is. Computed from the same checks the
        // report lists, in the order a support engineer would rule
        // them out.
        public static string Diagnose(List<RepairCheck> checks)
        {
            RepairCheck settings = Find(checks, CheckSettings);
            if (settings != null && !settings.Ok)
            {
                return "Diagnosis: settings problem - kayan.env was not found, so nothing knows where the database is. Run the installer (or Repair) to recreate it; company data is not touched.";
            }
            RepairCheck content = Find(checks, "Settings point at a database");
            if (content != null && !content.Ok)
            {
                return "Diagnosis: settings problem - " + content.Detail + ".";
            }
            RepairCheck service = Find(checks, "PostgreSQL service (" + ServiceName + ")");
            if (service != null && !service.Ok)
            {
                return "Diagnosis: database service problem - " + service.Detail + ". Repair restarts it; company data is not touched.";
            }
            RepairCheck port = Find(checks, CheckDatabasePort);
            if (port != null && !port.Ok)
            {
                return "Diagnosis: database not accepting connections on the configured port, although the service claims to run. Repair re-registers the service; if it persists, check for another PostgreSQL using that port.";
            }
            for (int i = 0; i < checks.Count; i++)
            {
                if (!checks[i].Ok)
                {
                    return "Diagnosis: the installation itself is incomplete (" + checks[i].Name + "). Reinstall KAYAN ERP over the top; settings and company data are kept.";
                }
            }
            RepairCheck api = Find(checks, CheckApi);
            if (api != null && api.Detail.IndexOf("FIRST-RUN SETUP NOT COMPLETED", StringComparison.Ordinal) >= 0)
            {
                return "Diagnosis: everything is installed and running; first-run setup has not been completed. Open KAYAN ERP and create the company and the first administrator.";
            }
            RepairCheck log = Find(checks, CheckLog);
            if (log != null && log.Detail.IndexOf("first-run setup", StringComparison.Ordinal) >= 0)
            {
                return "Diagnosis: the installation is healthy; the last run was waiting at first-run setup. Open KAYAN ERP and create the company and the first administrator.";
            }
            if (log != null && log.Detail.IndexOf("no known failure signature", StringComparison.Ordinal) < 0
                && log.Detail.IndexOf("no server log yet", StringComparison.Ordinal) < 0)
            {
                return "Diagnosis: from the last server log - " + log.Detail + ".";
            }
            return "Diagnosis: no problems detected. If the program still misbehaves, open it once, then run this tool again so the fresh log can be read.";
        }

        private static RepairCheck Find(List<RepairCheck> checks, string name)
        {
            for (int i = 0; i < checks.Count; i++)
            {
                if (string.Equals(checks[i].Name, name, StringComparison.Ordinal)) { return checks[i]; }
            }
            return null;
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
                    // The one-sentence diagnosis, not a blanket "healthy":
                    // an installation can pass every check and still be
                    // waiting for its first-run setup, which is guidance
                    // the person in front of the machine actually needs.
                    status.Text = Diagnostics.Diagnose(results);
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
                "This will stop the running KAYAN ERP program, verify the bundled runtime, repair file permissions, restart the local PostgreSQL service, apply any pending database migrations, and finally start the real server briefly to prove it answers before calling the repair a success.\r\n\r\n"
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
