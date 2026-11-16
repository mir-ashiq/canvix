using System.Diagnostics;
using System.Globalization;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace CanvixLauncher;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        UpdateChecker.RunSelfCheck();
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }
}

internal sealed record RuntimeUpdateInfo(
    string Component,
    string InstalledVersion,
    string AvailableVersion,
    string Status,
    bool CanUpdate);

internal sealed class MainForm : Form
{
    private const string RepositoryUrl = "https://github.com/mir-ashiq/canvix";
    private const string LatestReleaseApiUrl = "https://api.github.com/repos/mir-ashiq/canvix/releases/latest";
    private const string InstallerAssetName = "CanvixSetup.exe";
    private const int AppPort = 3000;
    private const int PostgresPort = 54321;

    private static readonly HttpClient Http = CreateHttpClient();
    private readonly string _installDirectory = AppContext.BaseDirectory;
    private readonly string _runtimeDirectory = Path.Combine(AppContext.BaseDirectory, "runtime");
    private readonly string _applicationDirectory = Path.Combine(AppContext.BaseDirectory, "app");
    private readonly string _dataDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Canvix");
    private readonly Version _currentVersion = GetCurrentVersion();
    private readonly Label _status = new() { AutoSize = true, MaximumSize = new Size(410, 0) };
    private readonly ProgressBar _progress = new()
    {
        Style = ProgressBarStyle.Marquee,
        MarqueeAnimationSpeed = 30,
        Dock = DockStyle.Fill,
        Visible = false,
        Height = 8,
    };
    private readonly Button _startButton = new() { Text = "Start Canvix", AutoSize = true };
    private readonly Button _stopButton = new() { Text = "Stop", AutoSize = true };
    private readonly Button _checkButton = new() { Text = "Check for updates", AutoSize = true };
    private readonly Button _openButton = new() { Text = "Open GitHub", AutoSize = true };
    private Process? _applicationProcess;

    private string EnvPath => Path.Combine(_dataDirectory, ".env");
    private string AppPidPath => Path.Combine(_dataDirectory, "canvix.pid");
    private string PostgresDataDirectory => Path.Combine(_dataDirectory, "postgres");
    private string PostgresLogPath => Path.Combine(_dataDirectory, "postgres.log");
    private string NodePath => Path.Combine(_runtimeDirectory, "node.exe");
    private string PostgresBinPath(string name) => Path.Combine(_runtimeDirectory, "pgsql", "bin", name);

    public MainForm()
    {
        Text = "Canvix";
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(460, 220);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;

        var title = new Label
        {
            Text = "Canvix",
            AutoSize = true,
            Font = new Font(Font.FontFamily, 18, FontStyle.Bold),
        };
        var version = new Label { Text = $"Version {_currentVersion}", AutoSize = true };
        _status.Text = "Checking for updates...";

        _startButton.Click += async (_, _) => await StartCanvixAsync();
        _stopButton.Click += async (_, _) => await StopCanvixAsync();
        _checkButton.Click += async (_, _) => await CheckForUpdateAsync(false);
        _openButton.Click += (_, _) => OpenUrl(RepositoryUrl);

        var buttons = new FlowLayoutPanel
        {
            AutoSize = true,
            FlowDirection = FlowDirection.LeftToRight,
            Dock = DockStyle.Fill,
        };
        buttons.Controls.AddRange([_startButton, _stopButton, _checkButton, _openButton]);

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(18),
            ColumnCount = 1,
            RowCount = 5,
        };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.Controls.Add(title, 0, 0);
        layout.Controls.Add(version, 0, 1);
        layout.Controls.Add(_status, 0, 2);
        layout.Controls.Add(buttons, 0, 3);
        layout.Controls.Add(_progress, 0, 4);
        Controls.Add(layout);

        Load += async (_, _) => await OnLoadedAsync();
    }

    private async Task OnLoadedAsync()
    {
        try
        {
            EnsureEnvironmentFile();
            await CheckForUpdateAsync(true);
        }
        catch (Exception ex)
        {
            SetStatus(ex.Message);
        }
    }

    private async Task StartCanvixAsync()
    {
        SetBusy(true, "Starting local Canvix...");
        try
        {
            EnsureRuntimeFiles();
            EnsureEnvironmentFile();
            await EnsurePostgresAsync();
            SetStatus("Preparing the local Canvix database...");
            await RunDatabaseSetupAsync();
            await StartApplicationAsync();
            SetStatus($"Canvix is running at http://127.0.0.1:{AppPort}");
            OpenUrl($"http://127.0.0.1:{AppPort}");
        }
        catch (Exception ex)
        {
            SetStatus($"Could not start Canvix: {ex.Message}");
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async Task StopCanvixAsync()
    {
        SetBusy(true, "Stopping local Canvix...");
        try
        {
            await StopApplicationAsync();
            await StopPostgresAsync();
            SetStatus("Canvix is stopped. Local PostgreSQL data was kept.");
        }
        catch (Exception ex)
        {
            SetStatus($"Could not stop Canvix: {ex.Message}");
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async Task CheckForUpdateAsync(bool automatic)
    {
        SetBusy(true, "Checking GitHub for updates...");
        try
        {
            ReleaseInfo? release = null;
            string? githubError = null;
            try
            {
                release = await GetLatestReleaseAsync();
            }
            catch (Exception ex) when (ex is HttpRequestException or JsonException or InvalidOperationException)
            {
                githubError = ex.Message;
            }

            var rows = BuildUpdateRows(release, githubError);
            var dialogMessage = rows.Any(update => update.CanUpdate)
                ? "Download and install the latest Canvix package?"
                : "Canvix is up to date.";
            using var dialog = new UpdateDialog(rows, dialogMessage);
            if (dialog.ShowDialog(this) == DialogResult.Yes && release?.DownloadUri is not null)
            {
                await DownloadAndInstallAsync(release);
                return;
            }

            SetStatus("Update check complete.");
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException or InvalidOperationException)
        {
            SetStatus(automatic ? "Startup update check skipped: " + ex.Message : "Update check failed: " + ex.Message);
        }
        finally
        {
            SetBusy(false);
        }
    }

    private IReadOnlyList<RuntimeUpdateInfo> BuildUpdateRows(ReleaseInfo? release, string? githubError)
    {
        var availableVersion = release?.Version.ToString(3) ?? "unavailable";
        var launcherVersion = _currentVersion.ToString(3);
        var launcherCanUpdate = release is not null && release.Version > _currentVersion && release.DownloadUri is not null;
        var launcherStatus = release is null
            ? "check failed: " + githubError
            : launcherCanUpdate ? "update available" : "latest";

        return
        [
            new RuntimeUpdateInfo("Canvix package", launcherVersion, availableVersion, launcherStatus, launcherCanUpdate),
            new RuntimeUpdateInfo("Node.js runtime", "bundled", "bundled", "bundled", false),
            new RuntimeUpdateInfo("PostgreSQL runtime", "17.12", "bundled", "bundled", false),
        ];
    }

    private async Task DownloadAndInstallAsync(ReleaseInfo release)
    {
        SetBusy(true, $"Downloading Canvix {release.Version}...");
        var installerPath = Path.Combine(Path.GetTempPath(), $"CanvixSetup-{release.Version}.exe");
        try
        {
            await StopApplicationAsync();
            await StopPostgresAsync();

            var downloadUri = release.DownloadUri ?? throw new InvalidOperationException("This release has no setup EXE.");
            using var response = await Http.GetAsync(downloadUri, HttpCompletionOption.ResponseHeadersRead);
            response.EnsureSuccessStatusCode();
            if (response.Content.Headers.ContentLength is > 4L * 1024 * 1024 * 1024)
            {
                throw new InvalidOperationException("The installer is larger than the safety limit.");
            }

            await using (var input = await response.Content.ReadAsStreamAsync())
            await using (var output = File.Create(installerPath))
            {
                await input.CopyToAsync(output);
            }

            Process.Start(new ProcessStartInfo
            {
                FileName = installerPath,
                UseShellExecute = true,
            });
            Application.Exit();
        }
        catch
        {
            TryDelete(installerPath);
            throw;
        }
    }

    private void EnsureRuntimeFiles()
    {
        var required = new[]
        {
            NodePath,
            Path.Combine(_applicationDirectory, "server.js"),
            Path.Combine(_applicationDirectory, "scripts", "db-setup.mjs"),
            PostgresBinPath("initdb.exe"),
            PostgresBinPath("pg_ctl.exe"),
            PostgresBinPath("pg_isready.exe"),
            PostgresBinPath("createdb.exe"),
        };
        var missing = required.Where(path => !File.Exists(path)).ToArray();
        if (missing.Length > 0)
        {
            throw new InvalidOperationException("The standalone runtime is incomplete. Reinstall Canvix.");
        }
    }

    private async Task EnsurePostgresAsync()
    {
        Directory.CreateDirectory(_dataDirectory);
        if (!await IsPostgresReadyAsync())
        {
            if (!File.Exists(Path.Combine(PostgresDataDirectory, "PG_VERSION")))
            {
                if (Directory.Exists(PostgresDataDirectory) && Directory.EnumerateFileSystemEntries(PostgresDataDirectory).Any())
                {
                    throw new InvalidOperationException("The local PostgreSQL data directory is incomplete. Back it up, then reinstall Canvix.");
                }

                await InitializePostgresAsync();
            }

            var start = await RunProcessAsync(
                PostgresBinPath("pg_ctl.exe"),
                ["-D", PostgresDataDirectory, "-l", PostgresLogPath, "-o", $"-h 127.0.0.1 -p {PostgresPort}", "-w", "start"],
                _dataDirectory);
            if (start.ExitCode != 0 && !await IsPostgresReadyAsync())
            {
                throw new InvalidOperationException(ReadPostgresFailure(start.Error));
            }
        }

        var createDatabase = await RunProcessAsync(
            PostgresBinPath("createdb.exe"),
            ["-h", "127.0.0.1", "-p", PostgresPort.ToString(CultureInfo.InvariantCulture), "-U", "canvix", "canvix"],
            _dataDirectory,
            LoadEnvironment());
        if (createDatabase.ExitCode != 0 &&
            !createDatabase.Error.Contains("already exists", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(createDatabase.Error.Trim());
        }
    }

    private async Task InitializePostgresAsync()
    {
        Directory.CreateDirectory(PostgresDataDirectory);
        var passwordFile = Path.Combine(Path.GetTempPath(), $"canvix-db-{Guid.NewGuid():N}.txt");
        try
        {
            File.WriteAllText(passwordFile, GetEnvironmentValue("POSTGRES_PASSWORD", ""));
            var result = await RunProcessAsync(
                PostgresBinPath("initdb.exe"),
                ["-D", PostgresDataDirectory, "-U", "canvix", "--pwfile", passwordFile, "--auth-local=trust", "--auth-host=scram-sha-256", "--encoding=UTF8", "--locale=C"],
                _dataDirectory);
            if (result.ExitCode != 0)
            {
                throw new InvalidOperationException(result.Error.Trim());
            }
        }
        finally
        {
            TryDelete(passwordFile);
        }
    }

    private async Task<bool> IsPostgresReadyAsync()
    {
        if (!File.Exists(PostgresBinPath("pg_isready.exe"))) return false;
        var result = await RunProcessAsync(
            PostgresBinPath("pg_isready.exe"),
            ["-h", "127.0.0.1", "-p", PostgresPort.ToString(CultureInfo.InvariantCulture), "-U", "canvix"],
            _dataDirectory);
        return result.ExitCode == 0;
    }

    private async Task RunDatabaseSetupAsync()
    {
        var result = await RunProcessAsync(
            NodePath,
            [Path.Combine("scripts", "db-setup.mjs")],
            _applicationDirectory,
            LoadEnvironment());
        if (result.ExitCode != 0)
        {
            throw new InvalidOperationException(
                string.IsNullOrWhiteSpace(result.Error) ? "Local database setup failed." : result.Error.Trim());
        }
    }

    private async Task StartApplicationAsync()
    {
        if (await IsApplicationHealthyAsync()) return;

        var startInfo = new ProcessStartInfo
        {
            FileName = NodePath,
            WorkingDirectory = _applicationDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        startInfo.ArgumentList.Add("server.js");
        foreach (var pair in LoadEnvironment()) startInfo.Environment[pair.Key] = pair.Value;

        _applicationProcess = Process.Start(startInfo)
            ?? throw new InvalidOperationException("Canvix server could not start.");
        File.WriteAllText(AppPidPath, _applicationProcess.Id.ToString(CultureInfo.InvariantCulture));

        for (var attempt = 0; attempt < 60; attempt++)
        {
            if (_applicationProcess.HasExited)
            {
                throw new InvalidOperationException("Canvix server stopped during startup.");
            }
            if (await IsApplicationHealthyAsync()) return;
            await Task.Delay(1000);
        }

        throw new InvalidOperationException("Canvix server did not become ready within 60 seconds.");
    }

    private async Task<bool> IsApplicationHealthyAsync()
    {
        try
        {
            using var response = await Http.GetAsync($"http://127.0.0.1:{AppPort}/api/health");
            return response.IsSuccessStatusCode;
        }
        catch (HttpRequestException)
        {
            return false;
        }
    }

    private async Task StopApplicationAsync()
    {
        Process? process = _applicationProcess;
        if (process is null && File.Exists(AppPidPath) && int.TryParse(File.ReadAllText(AppPidPath), out var pid))
        {
            try { process = Process.GetProcessById(pid); } catch (ArgumentException) { }
        }

        if (process is not null && !process.HasExited)
        {
            process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync();
        }
        _applicationProcess = null;
        TryDelete(AppPidPath);
    }

    private async Task StopPostgresAsync()
    {
        if (!await IsPostgresReadyAsync()) return;
        var result = await RunProcessAsync(
            PostgresBinPath("pg_ctl.exe"),
            ["-D", PostgresDataDirectory, "-m", "fast", "-w", "stop"],
            _dataDirectory);
        if (result.ExitCode != 0 && await IsPostgresReadyAsync())
        {
            throw new InvalidOperationException(result.Error.Trim());
        }
    }

    private async Task<CommandResult> RunProcessAsync(
        string fileName,
        IEnumerable<string> arguments,
        string workingDirectory,
        IReadOnlyDictionary<string, string>? environment = null)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = fileName,
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        foreach (var argument in arguments) startInfo.ArgumentList.Add(argument);
        if (environment is not null)
        {
            foreach (var pair in environment) startInfo.Environment[pair.Key] = pair.Value;
        }

        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException($"{Path.GetFileName(fileName)} could not start.");
        var outputTask = process.StandardOutput.ReadToEndAsync();
        var errorTask = process.StandardError.ReadToEndAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(5));
        await process.WaitForExitAsync(timeout.Token);
        return new CommandResult(process.ExitCode, await outputTask, await errorTask);
    }

    private void EnsureEnvironmentFile()
    {
        Directory.CreateDirectory(_dataDirectory);
        var lines = File.Exists(EnvPath) ? File.ReadAllLines(EnvPath).ToList() : [];
        SetEnvironmentLine(lines, "CANVIX_VERSION", _currentVersion.ToString(3));
        SetEnvironmentLine(lines, "POSTGRES_DB", "canvix");
        SetEnvironmentLine(lines, "POSTGRES_USER", "canvix");
        SetEnvironmentLine(lines, "POSTGRES_PORT", PostgresPort.ToString(CultureInfo.InvariantCulture));
        SetEnvironmentLine(lines, "APP_PORT", AppPort.ToString(CultureInfo.InvariantCulture));
        SetEnvironmentLine(lines, "NODE_ENV", "production");
        SetEnvironmentLine(lines, "HOSTNAME", "127.0.0.1");
        if (string.IsNullOrWhiteSpace(GetEnvironmentValue("POSTGRES_PASSWORD", "", lines)))
        {
            SetEnvironmentLine(lines, "POSTGRES_PASSWORD", Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant());
        }

        var password = GetEnvironmentValue("POSTGRES_PASSWORD", "", lines);
        SetEnvironmentLine(lines, "DATABASE_URL", $"postgresql://canvix:{password}@127.0.0.1:{PostgresPort}/canvix");
        File.WriteAllLines(EnvPath, lines);
    }

    private Dictionary<string, string> LoadEnvironment()
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (!File.Exists(EnvPath)) return result;
        foreach (var line in File.ReadAllLines(EnvPath))
        {
            var trimmed = line.Trim();
            if (trimmed.Length == 0 || trimmed.StartsWith('#')) continue;
            var separator = trimmed.IndexOf('=');
            if (separator <= 0) continue;
            result[trimmed[..separator]] = trimmed[(separator + 1)..];
        }
        result["PORT"] = AppPort.ToString(CultureInfo.InvariantCulture);
        result["HOSTNAME"] = "127.0.0.1";
        return result;
    }

    private string GetEnvironmentValue(string name, string fallback, IReadOnlyList<string>? lines = null)
    {
        var source = lines ?? (File.Exists(EnvPath) ? File.ReadAllLines(EnvPath) : []);
        var prefix = name + "=";
        var line = source.FirstOrDefault(candidate => candidate.StartsWith(prefix, StringComparison.Ordinal));
        return line is null ? fallback : line[prefix.Length..].Trim();
    }

    private static void SetEnvironmentLine(IList<string> lines, string name, string value)
    {
        var prefix = name + "=";
        var index = Enumerable.Range(0, lines.Count)
            .FirstOrDefault(i => lines[i].StartsWith(prefix, StringComparison.Ordinal), -1);
        if (index >= 0) lines[index] = prefix + value;
        else lines.Add(prefix + value);
    }

    private static string ReadPostgresFailure(string fallback)
    {
        return string.IsNullOrWhiteSpace(fallback)
            ? "PostgreSQL could not start. Check the local PostgreSQL log in %ProgramData%\\Canvix."
            : fallback.Trim();
    }

    private void SetBusy(bool busy, string? status = null)
    {
        _startButton.Enabled = !busy;
        _stopButton.Enabled = !busy;
        _checkButton.Enabled = !busy;
        _progress.Visible = busy;
        if (status is not null) SetStatus(status);
    }

    private void SetStatus(string text)
    {
        if (InvokeRequired)
        {
            BeginInvoke(() => SetStatus(text));
            return;
        }
        _status.Text = text;
    }

    private static HttpClient CreateHttpClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("CanvixLauncher/0.23.2");
        client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return client;
    }

    private static Version GetCurrentVersion()
    {
        var version = Assembly.GetEntryAssembly()?.GetName().Version;
        return version is null ? new Version(0, 23, 2) : new Version(version.Major, version.Minor, Math.Max(version.Build, 0));
    }

    private static void OpenUrl(string url)
    {
        Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch
        {
            // A running process or installer can release the file later.
        }
    }

    private sealed record ReleaseInfo(Version Version, Uri? DownloadUri);
    private sealed record CommandResult(int ExitCode, string Output, string Error);

    private async Task<ReleaseInfo?> GetLatestReleaseAsync()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, LatestReleaseApiUrl);
        using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync();
        using var document = await JsonDocument.ParseAsync(stream);
        var root = document.RootElement;
        var tag = root.GetProperty("tag_name").GetString() ?? throw new JsonException("GitHub release has no tag.");
        if (!UpdateChecker.TryParseReleaseVersion(tag, out var version))
        {
            throw new InvalidOperationException($"GitHub release tag '{tag}' is not a stable version.");
        }

        string? downloadUrl = null;
        foreach (var asset in root.GetProperty("assets").EnumerateArray())
        {
            if (string.Equals(asset.GetProperty("name").GetString(), InstallerAssetName, StringComparison.Ordinal))
            {
                downloadUrl = asset.GetProperty("browser_download_url").GetString();
                break;
            }
        }

        Uri? uri = null;
        if (!string.IsNullOrWhiteSpace(downloadUrl))
        {
            if (!Uri.TryCreate(downloadUrl, UriKind.Absolute, out var parsed) ||
                parsed.Scheme != Uri.UriSchemeHttps ||
                !string.Equals(parsed.Host, "github.com", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("GitHub returned an invalid installer URL.");
            }
            uri = parsed;
        }
        return new ReleaseInfo(version, uri);
    }
}

internal static class UpdateChecker
{
    private static readonly Regex StableVersion = new("^v?(\\d+)\\.(\\d+)\\.(\\d+)$", RegexOptions.CultureInvariant);

    internal static bool TryParseReleaseVersion(string tag, out Version version)
    {
        var match = StableVersion.Match(tag.Trim());
        if (!match.Success || !Version.TryParse($"{match.Groups[1].Value}.{match.Groups[2].Value}.{match.Groups[3].Value}", out var parsed))
        {
            version = new Version(0, 0, 0);
            return false;
        }
        version = parsed;
        return true;
    }

    internal static void RunSelfCheck()
    {
        Debug.Assert(TryParseReleaseVersion("v1.2.3", out var parsed) && parsed.Equals(new Version(1, 2, 3)));
        Debug.Assert(!TryParseReleaseVersion("latest", out _));
    }
}
