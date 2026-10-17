using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace Kayan
{
    /// <summary>
    /// Starts a program with a token that PostgreSQL accepts on Windows.
    ///
    /// PostgreSQL refuses to run with administrative permissions. The check
    /// lives in the server itself (src/backend/main/main.c, check_root):
    ///
    ///     if (pgwin32_is_admin())
    ///         "Execution of PostgreSQL by a user with administrative
    ///          permissions is not permitted."
    ///
    /// pgwin32_is_admin() asks CheckTokenMembership() whether the
    /// Administrators (or Power Users) group is enabled in the current
    /// process token. That check runs before the server dispatches to its
    /// --boot mode, so it also applies to the bootstrap backend that
    /// initdb starts. An installer runs elevated, which means every
    /// PostgreSQL program it starts would refuse to run.
    ///
    /// This helper therefore duplicates the calling token, marks the
    /// Administrators and Power Users groups "deny only" - exactly what
    /// Windows does for a normal, non-elevated administrator session - and
    /// starts the program with that token. The calling process keeps its own
    /// elevated token, so it can still register services and change
    /// permissions afterwards.
    ///
    /// The program's standard output and standard error are written to one
    /// file, so PostgreSQL's own diagnostics survive in the install log.
    /// </summary>
    public static class UnelevatedProcess
    {
        private const uint TOKEN_ASSIGN_PRIMARY = 0x0001;
        private const uint TOKEN_DUPLICATE = 0x0002;
        private const uint TOKEN_QUERY = 0x0008;
        private const uint TOKEN_ADJUST_PRIVILEGES = 0x0020;
        private const uint TOKEN_ADJUST_GROUPS = 0x0040;
        private const uint TOKEN_ADJUST_SESSIONID = 0x0080;
        private const uint TOKEN_ADJUST_DEFAULT = 0x0100;

        private const uint SE_GROUP_USE_FOR_DENY_ONLY = 0x00000010;
        private const uint SE_PRIVILEGE_ENABLED = 0x00000002;

        private const uint GENERIC_READ = 0x80000000;
        private const uint GENERIC_WRITE = 0x40000000;
        private const uint FILE_SHARE_READ = 0x00000001;
        private const uint FILE_SHARE_WRITE = 0x00000002;
        private const uint OPEN_EXISTING = 3;
        private const uint CREATE_ALWAYS = 2;
        private const uint FILE_ATTRIBUTE_NORMAL = 0x00000080;
        private const uint FILE_FLAG_INHERIT_HANDLE = 0x10000000;
        private const uint STARTF_USESTDHANDLES = 0x00000100;

        private const uint WAIT_TIMEOUT = 0x00000102;
        private const uint INFINITE = 0xFFFFFFFF;

        private const int SecurityImpersonation = 2;
        private const int TokenPrimary = 2;

        /// <summary>The well-known SID of the built-in Administrators group.</summary>
        private const string AdministratorsSid = "S-1-5-32-544";

        /// <summary>The well-known SID of the built-in Power Users group.</summary>
        private const string PowerUsersSid = "S-1-5-32-547";

        [StructLayout(LayoutKind.Sequential)]
        private struct LUID
        {
            public uint LowPart;
            public int HighPart;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct LUID_AND_ATTRIBUTES
        {
            public LUID Luid;
            public uint Attributes;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct TOKEN_PRIVILEGES
        {
            public uint PrivilegeCount;
            public LUID_AND_ATTRIBUTES Privileges;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct SID_AND_ATTRIBUTES
        {
            public IntPtr Sid;
            public uint Attributes;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct STARTUPINFO
        {
            public int cb;
            public IntPtr lpReserved;
            public IntPtr lpDesktop;
            public IntPtr lpTitle;
            public int dwX;
            public int dwY;
            public int dwXSize;
            public int dwYSize;
            public int dwXCountChars;
            public int dwYCountChars;
            public int dwFillAttribute;
            public int dwFlags;
            public short wShowWindow;
            public short cbReserved2;
            public IntPtr lpReserved2;
            public IntPtr hStdInput;
            public IntPtr hStdOutput;
            public IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PROCESS_INFORMATION
        {
            public IntPtr hProcess;
            public IntPtr hThread;
            public int dwProcessId;
            public int dwThreadId;
        }

        [DllImport("kernel32.dll")]
        private static extern IntPtr GetCurrentProcess();

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetExitCodeProcess(IntPtr processHandle, out uint exitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool TerminateProcess(IntPtr handle, uint exitCode);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern IntPtr CreateFileW(
            string fileName,
            uint desiredAccess,
            uint shareMode,
            IntPtr securityAttributes,
            uint creationDisposition,
            uint flagsAndAttributes,
            IntPtr templateFile);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool OpenProcessToken(IntPtr processHandle, uint desiredAccess, out IntPtr tokenHandle);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool DuplicateTokenEx(
            IntPtr existingTokenHandle,
            uint desiredAccess,
            IntPtr tokenAttributes,
            IntPtr securityAttributes,
            int impersonationLevel,
            int tokenType,
            out IntPtr newTokenHandle);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool AdjustTokenGroups(
            IntPtr tokenHandle,
            bool resetToDefault,
            ref SID_AND_ATTRIBUTES newState,
            uint bufferLength,
            out uint returnLength);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool AdjustTokenPrivileges(
            IntPtr tokenHandle,
            bool disableAll,
            ref TOKEN_PRIVILEGES newState,
            uint bufferLength,
            out uint returnLength);

        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool LookupPrivilegeValue(string systemName, string name, out LUID luid);

        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern IntPtr ConvertStringSidToSid(string sidString, out IntPtr sid);

        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool CreateProcessAsUser(
            IntPtr token,
            string applicationName,
            StringBuilder commandLine,
            IntPtr processAttributes,
            IntPtr threadAttributes,
            bool inheritHandles,
            uint creationFlags,
            IntPtr environment,
            string currentDirectory,
            ref STARTUPINFO startupInfo,
            out PROCESS_INFORMATION processInformation);

        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool CreateProcessWithTokenW(
            IntPtr token,
            uint logonFlags,
            string applicationName,
            StringBuilder commandLine,
            uint creationFlags,
            IntPtr environment,
            string currentDirectory,
            ref STARTUPINFO startupInfo,
            out PROCESS_INFORMATION processInformation);

        [DllImport("kernel32.dll")]
        private static extern IntPtr LocalFree(IntPtr handle);

        /// <summary>
        /// Runs a program with a token that is not administrative and waits for
        /// it to finish.
        /// </summary>
        /// <param name="fileName">Full path of the program to start.</param>
        /// <param name="arguments">Command line arguments, already quoted.</param>
        /// <param name="workingDirectory">Working directory of the program.</param>
        /// <param name="outputPath">File that receives stdout and stderr.</param>
        /// <param name="timeoutMilliseconds">How long to wait before giving up.</param>
        /// <returns>The exit code of the program.</returns>
        public static int Run(
            string fileName,
            string arguments,
            string workingDirectory,
            string outputPath,
            int timeoutMilliseconds)
        {
            if (string.IsNullOrEmpty(fileName)) throw new ArgumentException("fileName is required", "fileName");
            if (string.IsNullOrEmpty(outputPath)) throw new ArgumentException("outputPath is required", "outputPath");

            IntPtr token = IntPtr.Zero;
            IntPtr primary = IntPtr.Zero;
            IntPtr input = IntPtr.Zero;
            IntPtr output = IntPtr.Zero;
            IntPtr process = IntPtr.Zero;
            IntPtr thread = IntPtr.Zero;
            try
            {
                const uint access = TOKEN_ASSIGN_PRIMARY | TOKEN_DUPLICATE | TOKEN_QUERY |
                                    TOKEN_ADJUST_PRIVILEGES | TOKEN_ADJUST_GROUPS |
                                    TOKEN_ADJUST_SESSIONID | TOKEN_ADJUST_DEFAULT;

                if (!OpenProcessToken(GetCurrentProcess(), access, out token) || token == IntPtr.Zero)
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenProcessToken failed");

                if (!DuplicateTokenEx(
                        token,
                        access & ~TOKEN_DUPLICATE,
                        IntPtr.Zero,
                        IntPtr.Zero,
                        SecurityImpersonation,
                        TokenPrimary,
                        out primary) || primary == IntPtr.Zero)
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "DuplicateTokenEx failed");

                EnablePrivilege(primary, "SeAssignPrimaryTokenPrivilege");
                EnablePrivilege(primary, "SeIncreaseQuotaNamePrivilege");
                DenyOnly(primary, AdministratorsSid);
                DenyOnly(primary, PowerUsersSid);

                input = CreateFileW(
                    "NUL",
                    GENERIC_READ,
                    FILE_SHARE_READ | FILE_SHARE_WRITE,
                    IntPtr.Zero,
                    OPEN_EXISTING,
                    FILE_ATTRIBUTE_NORMAL | FILE_FLAG_INHERIT_HANDLE,
                    IntPtr.Zero);
                output = CreateFileW(
                    outputPath,
                    GENERIC_WRITE,
                    FILE_SHARE_READ | FILE_SHARE_WRITE,
                    IntPtr.Zero,
                    CREATE_ALWAYS,
                    FILE_ATTRIBUTE_NORMAL | FILE_FLAG_INHERIT_HANDLE,
                    IntPtr.Zero);
                if (output == IntPtr.Zero || output == new IntPtr(-1))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not create the output file");

                StringBuilder commandLine = new StringBuilder();
                commandLine.Append('"').Append(fileName).Append('"');
                if (!string.IsNullOrEmpty(arguments)) commandLine.Append(' ').Append(arguments);
                // CreateProcess may change the command line in place, so it
                // needs a buffer it can write into.
                StringBuilder mutableCommandLine = new StringBuilder(commandLine.Length + 64);
                mutableCommandLine.Append(commandLine.ToString());

                STARTUPINFO startup = new STARTUPINFO();
                startup.cb = Marshal.SizeOf(typeof(STARTUPINFO));
                startup.dwFlags = (int)STARTF_USESTDHANDLES;
                startup.hStdInput = input;
                startup.hStdOutput = output;
                startup.hStdError = output;

                PROCESS_INFORMATION information;
                bool started = CreateProcessAsUser(
                    primary,
                    null,
                    mutableCommandLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    true,
                    0,
                    IntPtr.Zero,
                    string.IsNullOrEmpty(workingDirectory) ? null : workingDirectory,
                    ref startup,
                    out information);
                if (!started)
                {
                    int firstError = Marshal.GetLastWin32Error();
                    started = CreateProcessWithTokenW(
                        primary,
                        0,
                        null,
                        mutableCommandLine,
                        0,
                        IntPtr.Zero,
                        string.IsNullOrEmpty(workingDirectory) ? null : workingDirectory,
                        ref startup,
                        out information);
                    if (!started)
                        throw new Win32Exception(firstError, "The program could not be started with a non-administrator token");
                }

                process = information.hProcess;
                thread = information.hThread;

                uint waited = WaitForSingleObject(process, (uint)Math.Max(1, timeoutMilliseconds));
                if (waited == WAIT_TIMEOUT)
                {
                    TerminateProcess(process, 1);
                    throw new TimeoutException("The program did not finish within the time it was given.");
                }
                if (waited == INFINITE)
                    throw new InvalidOperationException("Waiting for the program failed.");

                uint exitCode;
                if (!GetExitCodeProcess(process, out exitCode))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "GetExitCodeProcess failed");
                return unchecked((int)exitCode);
            }
            finally
            {
                if (thread != IntPtr.Zero) CloseHandle(thread);
                if (process != IntPtr.Zero) CloseHandle(process);
                if (output != IntPtr.Zero && output != new IntPtr(-1)) CloseHandle(output);
                if (input != IntPtr.Zero && input != new IntPtr(-1)) CloseHandle(input);
                if (primary != IntPtr.Zero) CloseHandle(primary);
                if (token != IntPtr.Zero) CloseHandle(token);
            }
        }

        /// <summary>
        /// Marks one group of the token "deny only", so the group is present
        /// but never grants access. This is what a non-elevated administrator
        /// session looks like to Windows.
        /// </summary>
        private static void DenyOnly(IntPtr token, string sidText)
        {
            IntPtr sid = IntPtr.Zero;
            try
            {
                if (!ConvertStringSidToSid(sidText, out sid) || sid == IntPtr.Zero) return;
                SID_AND_ATTRIBUTES attributes = new SID_AND_ATTRIBUTES();
                attributes.Sid = sid;
                attributes.Attributes = SE_GROUP_USE_FOR_DENY_ONLY;
                uint returned;
                // A group that is not in the token at all is not an error
                // here: the group simply is not a problem.
                AdjustTokenGroups(
                    token,
                    false,
                    ref attributes,
                    (uint)Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES)),
                    out returned);
            }
            finally
            {
                if (sid != IntPtr.Zero) LocalFree(sid);
            }
        }

        /// <summary>
        /// Enables one privilege of the token, so the process may create a
        /// process with another token.
        /// </summary>
        private static void EnablePrivilege(IntPtr token, string name)
        {
            LUID luid;
            if (!LookupPrivilegeValue(null, name, out luid)) return;
            TOKEN_PRIVILEGES privileges = new TOKEN_PRIVILEGES();
            privileges.PrivilegeCount = 1;
            privileges.Privileges.Luid = luid;
            privileges.Privileges.Attributes = SE_PRIVILEGE_ENABLED;
            uint returned;
            AdjustTokenPrivileges(
                token,
                false,
                ref privileges,
                (uint)Marshal.SizeOf(typeof(TOKEN_PRIVILEGES)),
                out returned);
        }
    }
}
