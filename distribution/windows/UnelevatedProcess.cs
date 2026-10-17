using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace Kayan
{
    /// <summary>
    /// Starts a program with the restricted Windows token PostgreSQL requires.
    ///
    /// PostgreSQL's Windows backend rejects tokens for which
    /// CheckTokenMembership reports Administrators or Power Users. initdb
    /// normally handles this by re-executing itself with a restricted token,
    /// but that extra CreateProcessAsUser step can be blocked by endpoint
    /// security policy. This helper performs that step before initdb runs and
    /// sets PG_RESTRICT_EXEC=1 so initdb does not need to repeat it.
    ///
    /// This follows PostgreSQL's own restricted-token implementation in
    /// src/common/restricted_token.c: CreateRestrictedToken disables the two
    /// privileged groups and all privileges, then the current user is added
    /// to the new token's default DACL so it can create the child processes
    /// and pipes used by initdb. The installer keeps its elevated token and
    /// can still register the Windows service after initialization.
    ///
    /// stdout and stderr are inherited file handles so the caller can retain
    /// PostgreSQL's diagnostics without printing secrets to the console.
    /// </summary>
    public static class UnelevatedProcess
    {
        private const uint TOKEN_ASSIGN_PRIMARY = 0x0001;
        private const uint TOKEN_DUPLICATE = 0x0002;
        private const uint TOKEN_QUERY = 0x0008;
        private const uint TOKEN_ADJUST_PRIVILEGES = 0x0020;
        private const uint TOKEN_ADJUST_DEFAULT = 0x0080;

        private const uint DISABLE_MAX_PRIVILEGE = 0x00000001;
        private const uint GENERIC_ALL = 0x10000000;
        private const uint OBJECT_INHERIT_ACE = 0x01;

        private const uint GENERIC_READ = 0x80000000;
        private const uint GENERIC_WRITE = 0x40000000;
        private const uint FILE_SHARE_READ = 0x00000001;
        private const uint FILE_SHARE_WRITE = 0x00000002;
        private const uint OPEN_EXISTING = 3;
        private const uint CREATE_ALWAYS = 2;
        private const uint FILE_ATTRIBUTE_NORMAL = 0x00000080;
        private const uint STARTF_USESTDHANDLES = 0x00000100;

        private const uint WAIT_TIMEOUT = 0x00000102;
        private const uint WAIT_FAILED = 0xFFFFFFFF;
        private const int SecurityImpersonation = 2;
        private const int TokenPrimary = 1;
        private const int TokenUser = 1;
        private const int TokenDefaultDacl = 6;
        private const uint AclRevision = 2;
        private const uint AclSizeInformation = 2;

        private const string AdministratorsSid = "S-1-5-32-544";
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

        [StructLayout(LayoutKind.Sequential)]
        private struct TOKEN_DEFAULT_DACL
        {
            public IntPtr DefaultDacl;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct ACL_SIZE_INFORMATION
        {
            public uint AceCount;
            public uint AclBytesInUse;
            public uint AclBytesFree;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct SECURITY_ATTRIBUTES
        {
            public int Length;
            public IntPtr SecurityDescriptor;
            [MarshalAs(UnmanagedType.Bool)] public bool InheritHandle;
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
            ref SECURITY_ATTRIBUTES securityAttributes,
            uint creationDisposition,
            uint flagsAndAttributes,
            IntPtr templateFile);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool OpenProcessToken(IntPtr processHandle, uint desiredAccess, out IntPtr tokenHandle);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool CreateRestrictedToken(
            IntPtr existingTokenHandle,
            uint flags,
            uint disableSidCount,
            IntPtr sidsToDisable,
            uint deletePrivilegeCount,
            IntPtr privilegesToDelete,
            uint restrictedSidCount,
            IntPtr sidsToRestrict,
            out IntPtr newTokenHandle);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool DuplicateTokenEx(
            IntPtr existingTokenHandle,
            uint desiredAccess,
            IntPtr tokenAttributes,
            int impersonationLevel,
            int tokenType,
            out IntPtr newTokenHandle);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool AdjustTokenPrivileges(
            IntPtr tokenHandle,
            bool disableAll,
            ref TOKEN_PRIVILEGES newState,
            uint bufferLength,
            out uint returnLength,
            IntPtr previousState);

        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool LookupPrivilegeValue(string systemName, string name, out LUID luid);

        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool ConvertStringSidToSid(string sidString, out IntPtr sid);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool GetTokenInformation(
            IntPtr tokenHandle,
            int tokenInformationClass,
            IntPtr tokenInformation,
            uint tokenInformationLength,
            out uint returnLength);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool SetTokenInformation(
            IntPtr tokenHandle,
            int tokenInformationClass,
            IntPtr tokenInformation,
            uint tokenInformationLength);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool GetAclInformation(
            IntPtr acl,
            out ACL_SIZE_INFORMATION information,
            uint informationLength,
            uint informationClass);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool GetAce(IntPtr acl, uint aceIndex, out IntPtr ace);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool InitializeAcl(IntPtr acl, uint aclLength, uint aclRevision);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool AddAce(IntPtr acl, uint aclRevision, uint startingAceIndex, IntPtr aceList, uint aceListLength);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool AddAccessAllowedAceEx(IntPtr acl, uint aclRevision, uint aceFlags, uint accessMask, IntPtr sid);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern uint GetLengthSid(IntPtr sid);

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

        [DllImport("kernel32.dll")]
        private static extern IntPtr LocalFree(IntPtr handle);

        /// <summary>Runs a program with a PostgreSQL-compatible restricted token.</summary>
        public static int Run(string fileName, string arguments, string workingDirectory, string outputPath, int timeoutMilliseconds)
        {
            if (string.IsNullOrEmpty(fileName)) throw new ArgumentException("fileName is required", "fileName");
            if (string.IsNullOrEmpty(outputPath)) throw new ArgumentException("outputPath is required", "outputPath");

            IntPtr callerToken = IntPtr.Zero;
            IntPtr restrictedToken = IntPtr.Zero;
            IntPtr primaryToken = IntPtr.Zero;
            IntPtr adminSid = IntPtr.Zero;
            IntPtr powerUsersSid = IntPtr.Zero;
            IntPtr disableGroups = IntPtr.Zero;
            IntPtr input = IntPtr.Zero;
            IntPtr output = IntPtr.Zero;
            IntPtr process = IntPtr.Zero;
            IntPtr thread = IntPtr.Zero;
            try
            {
                uint callerAccess = TOKEN_QUERY | TOKEN_DUPLICATE | TOKEN_ADJUST_PRIVILEGES;
                if (!OpenProcessToken(GetCurrentProcess(), callerAccess, out callerToken) || callerToken == IntPtr.Zero)
                    throw LastError("OpenProcessToken failed");

                // CreateProcessAsUser requires these privileges in the caller's
                // token. Enabling them here does not grant them to the child.
                EnablePrivilege(callerToken, "SeAssignPrimaryTokenPrivilege");
                EnablePrivilege(callerToken, "SeIncreaseQuotaPrivilege");

                if (!ConvertStringSidToSid(AdministratorsSid, out adminSid) || adminSid == IntPtr.Zero)
                    throw LastError("Could not create the Administrators SID");
                if (!ConvertStringSidToSid(PowerUsersSid, out powerUsersSid) || powerUsersSid == IntPtr.Zero)
                    throw LastError("Could not create the Power Users SID");

                int groupSize = Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES));
                disableGroups = Marshal.AllocHGlobal(groupSize * 2);
                SID_AND_ATTRIBUTES group = new SID_AND_ATTRIBUTES { Sid = adminSid, Attributes = 0 };
                Marshal.StructureToPtr(group, disableGroups, false);
                group = new SID_AND_ATTRIBUTES { Sid = powerUsersSid, Attributes = 0 };
                Marshal.StructureToPtr(group, IntPtr.Add(disableGroups, groupSize), false);

                uint tokenAccess = TOKEN_ASSIGN_PRIMARY | TOKEN_DUPLICATE | TOKEN_QUERY |
                                   TOKEN_ADJUST_PRIVILEGES | TOKEN_ADJUST_DEFAULT;
                if (!CreateRestrictedToken(callerToken, DISABLE_MAX_PRIVILEGE, 2, disableGroups,
                                           0, IntPtr.Zero, 0, IntPtr.Zero, out restrictedToken) ||
                    restrictedToken == IntPtr.Zero)
                    throw LastError("CreateRestrictedToken failed");

                AddCurrentUserToTokenDacl(restrictedToken);

                if (!DuplicateTokenEx(restrictedToken, tokenAccess, IntPtr.Zero,
                                      SecurityImpersonation, TokenPrimary, out primaryToken) ||
                    primaryToken == IntPtr.Zero)
                    throw LastError("DuplicateTokenEx failed");

                SECURITY_ATTRIBUTES inheritable = new SECURITY_ATTRIBUTES();
                inheritable.Length = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
                inheritable.InheritHandle = true;
                input = CreateFileW("NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                                    ref inheritable, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, IntPtr.Zero);
                output = CreateFileW(outputPath, GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
                                     ref inheritable, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, IntPtr.Zero);
                if (input == IntPtr.Zero || input == new IntPtr(-1)) throw LastError("Could not open NUL for child stdin");
                if (output == IntPtr.Zero || output == new IntPtr(-1)) throw LastError("Could not create the PostgreSQL output log");

                StringBuilder commandLine = new StringBuilder();
                commandLine.Append('"').Append(fileName).Append('"');
                if (!string.IsNullOrEmpty(arguments)) commandLine.Append(' ').Append(arguments);
                StringBuilder mutableCommandLine = new StringBuilder(commandLine.Length + 64);
                mutableCommandLine.Append(commandLine.ToString());

                STARTUPINFO startup = new STARTUPINFO();
                startup.cb = Marshal.SizeOf(typeof(STARTUPINFO));
                startup.dwFlags = (int)STARTF_USESTDHANDLES;
                startup.hStdInput = input;
                startup.hStdOutput = output;
                startup.hStdError = output;

                PROCESS_INFORMATION information;
                if (!CreateProcessAsUser(primaryToken, null, mutableCommandLine,
                                         IntPtr.Zero, IntPtr.Zero, true, 0, IntPtr.Zero,
                                         string.IsNullOrEmpty(workingDirectory) ? null : workingDirectory,
                                         ref startup, out information))
                    throw LastError("Could not start PostgreSQL with a non-administrator token");

                process = information.hProcess;
                thread = information.hThread;
                uint waited = WaitForSingleObject(process, (uint)Math.Max(1, timeoutMilliseconds));
                if (waited == WAIT_TIMEOUT)
                {
                    TerminateProcess(process, 1);
                    throw new TimeoutException("PostgreSQL initialization did not finish before the timeout.");
                }
                if (waited == WAIT_FAILED) throw LastError("Waiting for PostgreSQL failed");

                uint exitCode;
                if (!GetExitCodeProcess(process, out exitCode)) throw LastError("GetExitCodeProcess failed");
                return unchecked((int)exitCode);
            }
            finally
            {
                if (thread != IntPtr.Zero) CloseHandle(thread);
                if (process != IntPtr.Zero) CloseHandle(process);
                if (output != IntPtr.Zero && output != new IntPtr(-1)) CloseHandle(output);
                if (input != IntPtr.Zero && input != new IntPtr(-1)) CloseHandle(input);
                if (primaryToken != IntPtr.Zero) CloseHandle(primaryToken);
                if (restrictedToken != IntPtr.Zero) CloseHandle(restrictedToken);
                if (callerToken != IntPtr.Zero) CloseHandle(callerToken);
                if (disableGroups != IntPtr.Zero) Marshal.FreeHGlobal(disableGroups);
                if (powerUsersSid != IntPtr.Zero) LocalFree(powerUsersSid);
                if (adminSid != IntPtr.Zero) LocalFree(adminSid);
            }
        }

        /// <summary>
        /// Adds the current user to the restricted token's default DACL.
        /// Windows may otherwise omit an Administrator user's individual SID
        /// after the Administrators group has been disabled.
        /// </summary>
        private static void AddCurrentUserToTokenDacl(IntPtr token)
        {
            IntPtr userInfo = IntPtr.Zero;
            IntPtr daclInfo = IntPtr.Zero;
            IntPtr newAcl = IntPtr.Zero;
            try
            {
                uint needed;
                GetTokenInformation(token, TokenUser, IntPtr.Zero, 0, out needed);
                if (needed == 0) throw LastError("Could not size TokenUser information");
                userInfo = Marshal.AllocHGlobal((int)needed);
                if (!GetTokenInformation(token, TokenUser, userInfo, needed, out needed))
                    throw LastError("Could not read TokenUser information");
                SID_AND_ATTRIBUTES user = (SID_AND_ATTRIBUTES)Marshal.PtrToStructure(userInfo, typeof(SID_AND_ATTRIBUTES));

                GetTokenInformation(token, TokenDefaultDacl, IntPtr.Zero, 0, out needed);
                if (needed == 0) throw LastError("Could not size TokenDefaultDacl information");
                daclInfo = Marshal.AllocHGlobal((int)needed);
                if (!GetTokenInformation(token, TokenDefaultDacl, daclInfo, needed, out needed))
                    throw LastError("Could not read TokenDefaultDacl information");
                TOKEN_DEFAULT_DACL original = (TOKEN_DEFAULT_DACL)Marshal.PtrToStructure(daclInfo, typeof(TOKEN_DEFAULT_DACL));
                if (original.DefaultDacl == IntPtr.Zero) throw new InvalidOperationException("The restricted token has no default DACL.");

                ACL_SIZE_INFORMATION sizeInfo;
                if (!GetAclInformation(original.DefaultDacl, out sizeInfo,
                                       (uint)Marshal.SizeOf(typeof(ACL_SIZE_INFORMATION)), AclSizeInformation))
                    throw LastError("Could not read the token DACL");

                uint sidLength = GetLengthSid(user.Sid);
                uint aclLength = sizeInfo.AclBytesInUse + 12 + sidLength - 4;
                newAcl = Marshal.AllocHGlobal((int)aclLength);
                if (!InitializeAcl(newAcl, aclLength, AclRevision)) throw LastError("Could not initialize the restricted token DACL");

                for (uint i = 0; i < sizeInfo.AceCount; i++)
                {
                    IntPtr ace;
                    if (!GetAce(original.DefaultDacl, i, out ace)) throw LastError("Could not read an ACE from the token DACL");
                    ushort aceSize = unchecked((ushort)Marshal.ReadInt16(ace, 2));
                    if (!AddAce(newAcl, AclRevision, 0xFFFFFFFF, ace, aceSize))
                        throw LastError("Could not copy an ACE into the restricted token DACL");
                }

                if (!AddAccessAllowedAceEx(newAcl, AclRevision, OBJECT_INHERIT_ACE, GENERIC_ALL, user.Sid))
                    throw LastError("Could not add the current user to the restricted token DACL");

                TOKEN_DEFAULT_DACL replacement = new TOKEN_DEFAULT_DACL { DefaultDacl = newAcl };
                IntPtr replacementBuffer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(TOKEN_DEFAULT_DACL)));
                try
                {
                    Marshal.StructureToPtr(replacement, replacementBuffer, false);
                    if (!SetTokenInformation(token, TokenDefaultDacl, replacementBuffer, aclLength))
                        throw LastError("Could not update the restricted token DACL");
                }
                finally { Marshal.FreeHGlobal(replacementBuffer); }
            }
            finally
            {
                if (newAcl != IntPtr.Zero) Marshal.FreeHGlobal(newAcl);
                if (daclInfo != IntPtr.Zero) Marshal.FreeHGlobal(daclInfo);
                if (userInfo != IntPtr.Zero) Marshal.FreeHGlobal(userInfo);
            }
        }

        private static void EnablePrivilege(IntPtr token, string name)
        {
            LUID luid;
            if (!LookupPrivilegeValue(null, name, out luid)) return;
            TOKEN_PRIVILEGES privileges = new TOKEN_PRIVILEGES();
            privileges.PrivilegeCount = 1;
            privileges.Privileges.Luid = luid;
            privileges.Privileges.Attributes = 0x00000002;
            uint returned;
            AdjustTokenPrivileges(token, false, ref privileges, 0, out returned, IntPtr.Zero);
        }

        private static Win32Exception LastError(string message)
        {
            return new Win32Exception(Marshal.GetLastWin32Error(), message);
        }
    }
}
