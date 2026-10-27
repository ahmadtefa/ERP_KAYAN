using System.Diagnostics;
using System.Text;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace KayanKeyGenerator;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var smokeMarker = ReadArgument(args, "--smoke-marker");
        try
        {
            using var window = new GeneratorWindow(smokeMarker);
            Application.Run(window);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "تعذر تشغيل مولّد مفاتيح كيان.\nKAYAN Key Generator could not start.\n\n" + ex.Message,
                "KAYAN Key Generator",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            Environment.ExitCode = 1;
        }
    }

    private static string? ReadArgument(string[] args, string name)
    {
        for (var i = 0; i < args.Length - 1; i++)
            if (string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase))
                return args[i + 1];
        return null;
    }
}

internal sealed class GeneratorWindow : Form
{
    private readonly WebView2 _web = new() { Dock = DockStyle.Fill };
    private readonly string? _smokeMarker;
    private Process? _server;
    private string? _url;
    private bool _closing;

    public GeneratorWindow(string? smokeMarker)
    {
        _smokeMarker = smokeMarker;
        Text = "مولّد مفاتيح ترخيص كيان — KAYAN Key Generator";
        Width = 1180;
        Height = 850;
        MinimumSize = new Size(850, 620);
        StartPosition = FormStartPosition.CenterScreen;
        RightToLeft = RightToLeft.Yes;
        RightToLeftLayout = false;
        Controls.Add(_web);
        Shown += async (_, _) => await StartAsync();
        FormClosing += (_, _) => StopServer();
    }

    private async Task StartAsync()
    {
        try
        {
            StartServer();
            var userData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "KAYAN", "KeyGenerator", "WebView2");
            Directory.CreateDirectory(userData);
            var environment = await CoreWebView2Environment.CreateAsync(null, userData);
            await _web.EnsureCoreWebView2Async(environment);
            _web.CoreWebView2.Settings.AreDevToolsEnabled = false;
            _web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            _web.CoreWebView2.Settings.IsStatusBarEnabled = false;
            _web.CoreWebView2.NavigationStarting += (_, e) =>
            {
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri) ||
                    !string.Equals(uri.Host, "127.0.0.1", StringComparison.OrdinalIgnoreCase) ||
                    !string.Equals(uri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase))
                {
                    e.Cancel = true;
                }
            };
            _web.CoreWebView2.DownloadStarting += (_, e) =>
            {
                using var dialog = new SaveFileDialog
                {
                    Title = "حفظ ملف الترخيص — Save licence key",
                    FileName = "kayan-licence-key.txt",
                    Filter = "Text files (*.txt)|*.txt|All files (*.*)|*.*",
                    AddExtension = true,
                    DefaultExt = "txt"
                };
                if (dialog.ShowDialog(this) == DialogResult.OK)
                    e.ResultFilePath = dialog.FileName;
                else
                    e.Cancel = true;
            };
            _web.CoreWebView2.NavigationCompleted += (_, e) =>
            {
                if (e.IsSuccess && !string.IsNullOrWhiteSpace(_smokeMarker))
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(_smokeMarker))!);
                    File.WriteAllText(_smokeMarker, "NATIVE_WINDOW_READY\n" + _url, Encoding.UTF8);
                }
            };
            _web.CoreWebView2.Navigate(_url!);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                this,
                "تعذر فتح نافذة المولّد. تأكد من تثبيت Microsoft Edge WebView2 Runtime.\n" +
                "The native window could not be initialized. Install the WebView2 Runtime and retry.\n\n" +
                ex.Message,
                "KAYAN Key Generator",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            Close();
        }
    }

    private void StartServer()
    {
        var serverPath = Path.Combine(AppContext.BaseDirectory, "KAYAN-Key-Generator-Server.exe");
        if (!File.Exists(serverPath))
            throw new FileNotFoundException("The bundled local licence service is missing.", serverPath);

        var start = new ProcessStartInfo(serverPath)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = AppContext.BaseDirectory
        };
        start.ArgumentList.Add("gui");
        start.ArgumentList.Add("--no-browser");
        start.ArgumentList.Add("--port");
        start.ArgumentList.Add("0");
        _server = new Process { StartInfo = start, EnableRaisingEvents = true };
        _server.OutputDataReceived += (_, e) => CaptureUrl(e.Data);
        _server.ErrorDataReceived += (_, e) => CaptureUrl(e.Data);
        if (!_server.Start())
            throw new InvalidOperationException("The local licence service could not be started.");
        _server.BeginOutputReadLine();
        _server.BeginErrorReadLine();

        var deadline = DateTime.UtcNow.AddSeconds(20);
        while (string.IsNullOrWhiteSpace(_url) && DateTime.UtcNow < deadline)
        {
            if (_server.HasExited)
                throw new InvalidOperationException("The local licence service stopped before its window was ready.");
            Thread.Sleep(50);
        }
        if (string.IsNullOrWhiteSpace(_url))
            throw new TimeoutException("The local licence service did not become ready within 20 seconds.");
    }

    private void CaptureUrl(string? line)
    {
        const string prefix = "KAYAN-GUI-URL=";
        if (line?.StartsWith(prefix, StringComparison.Ordinal) == true)
            _url = line[prefix.Length..].Trim();
    }

    private void StopServer()
    {
        if (_closing) return;
        _closing = true;
        try
        {
            if (_server is { HasExited: false })
            {
                _server.Kill(true);
                _server.WaitForExit(3000);
            }
        }
        catch { /* Closing the UI must still complete. */ }
        finally
        {
            _server?.Dispose();
            _server = null;
        }
    }
}
