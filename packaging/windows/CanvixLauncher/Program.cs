using System.ComponentModel;
using System.Diagnostics;
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
    private const string DockerDownloadPageUrl = "https://www.docker.com/products/docker-desktop/";
    private const string DockerInstallerUrl = "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe";
    private const string InstallerAssetName = "CanvixSetup.exe";

    private static readonly HttpClient Http = CreateHttpClient();
    private static readonly HttpClient DockerHttp = CreateDockerHttpClient();
    private readonly string _installDirectory = AppContext.BaseDirectory;
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

    private string EnvPath => Path.Combine(_dataDirectory, ".env");
    private string ComposePath => Path.Combine(_installDirectory, "docker-compose.yml");

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
        _status.Text = "Checking Docker and GitHub for updates...";

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
        SetBusy(true, "Starting Canvix containers...");
        try
        {
            if (!await IsDockerAvailableAsync())
            {
                await OfferDockerInstallAsync();
                return;
            }

            EnsureEnvironmentFile();
            SetStatus("Starting Canvix containers...\r\nThe first start may download the application image.");
            await RunDockerComposeAsync("up", "-d", "--pull", "missing");
            var port = GetEnvironmentValue("WEB_PORT", "3000");
            SetStatus($"Canvix is running at http://localhost:{port}");
            OpenUrl($"http://localhost:{port}");
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
        SetBusy(true, "Stopping Canvix containers...");
        try
        {
            await RunDockerComposeAsync("down");
            SetStatus("Canvix is stopped. PostgreSQL data was kept.");
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
        SetBusy(true, "Checking GitHub and runtime versions...");
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

            var dockerAvailable = await IsDockerAvailableAsync();
            var rows = await BuildUpdateRowsAsync(release, dockerAvailable, githubError);
            var hasRuntimeUpdate = rows.Any(update => update.Component == "Canvix web" && update.CanUpdate);
            var dialogMessage = dockerAvailable
                ? rows.Any(update => update.CanUpdate) ? "Download and update available Canvix software?" : "All Canvix software is latest."
                : "Docker Desktop is required to run Canvix.";
            using var dialog = new UpdateDialog(rows, dialogMessage);
            if (dialog.ShowDialog(this) == DialogResult.Yes)
            {
                var hasLauncherUpdate = rows.Any(update => update.Component == "Canvix launcher" && update.CanUpdate);
                if (hasLauncherUpdate && release?.DownloadUri is not null)
                {
                    await DownloadAndInstallAsync(release);
                    return;
                }

                if (hasRuntimeUpdate && release is not null)
                {
                    await ApplyRuntimeUpdatesAsync(release.Version);
                }
            }

            if (!dockerAvailable)
            {
                await OfferDockerInstallAsync();
            }
            else
            {
                SetStatus("Update check complete.");
            }
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

    private async Task<IReadOnlyList<RuntimeUpdateInfo>> BuildUpdateRowsAsync(
        ReleaseInfo? release,
        bool dockerAvailable,
        string? githubError)
    {
        var availableVersion = release?.Version.ToString(3) ?? "unavailable";
        var configuredVersion = GetEnvironmentValue("CANVIX_VERSION", _currentVersion.ToString(3));
        var runtimeCanUpdate = release is not null && IsOlderVersion(configuredVersion, release.Version);
        var launcherVersion = _currentVersion.ToString(3);
        var launcherCanUpdate = release is not null && release.Version > _currentVersion && release.DownloadUri is not null;
        var launcherStatus = release is null
            ? "check failed: " + githubError
            : release.Version > _currentVersion
                ? release.DownloadUri is null ? "installer unavailable" : "update available"
                : "latest";
        var runtimeStatus = release is null
            ? "check failed: " + githubError
            : runtimeCanUpdate ? "update available" : dockerAvailable ? "latest" : "Docker required";
        var dockerVersion = dockerAvailable ? await GetDockerVersionAsync() : "not installed or running";

        return
        [
            new RuntimeUpdateInfo("Canvix launcher", launcherVersion, availableVersion, launcherStatus, launcherCanUpdate),
            new RuntimeUpdateInfo("Canvix web", configuredVersion, availableVersion, runtimeStatus, runtimeCanUpdate),
            new RuntimeUpdateInfo("PostgreSQL", "17-alpine", "pinned", "pinned", false),
            new RuntimeUpdateInfo("Docker Engine", dockerVersion, "managed by Docker Desktop", dockerAvailable ? "installed" : "required", false),
        ];
    }

    private async Task ApplyRuntimeUpdatesAsync(Version releaseVersion)
    {
        SetBusy(true, $"Downloading Canvix {releaseVersion}...\r\nThis may take several minutes.");
        try
        {
            EnsureEnvironmentFile();
            var lines = File.ReadAllLines(EnvPath).ToList();
            SetEnvironmentLine(lines, "CANVIX_VERSION", releaseVersion.ToString(3));
            File.WriteAllLines(EnvPath, lines);
            await RunDockerComposeAsync("pull", "web");
            SetStatus("Image downloaded. Restarting Canvix...");
            await RunDockerComposeAsync("up", "-d", "--no-build", "--force-recreate", "web");
            SetStatus("Runtime update complete. Canvix is ready.");
        }
        catch (Exception ex)
        {
            SetStatus($"Runtime update failed: {ex.Message}");
        }
    }

    private async Task<bool> IsDockerAvailableAsync()
    {
        try
        {
            return (await RunDockerAsync("info")).ExitCode == 0;
        }
        catch (Win32Exception)
        {
            return false;
        }
        catch (InvalidOperationException)
        {
            return false;
        }
    }

    private async Task<string> GetDockerVersionAsync()
    {
        var result = await RunDockerAsync("version", "--format", "{{.Server.Version}}");
        return result.ExitCode == 0 && !string.IsNullOrWhiteSpace(result.Output)
            ? result.Output.Trim()
            : "unknown";
    }

    private static bool IsOlderVersion(string installed, Version available)
    {
        return !Version.TryParse(installed, out var version) || version.CompareTo(available) < 0;
    }

    private async Task OfferDockerInstallAsync()
    {
        var choice = MessageBox.Show(
            this,
            "Docker Desktop is required to run Canvix. Download and install it now?",
            "Docker Desktop required",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Warning);
        if (choice != DialogResult.Yes)
        {
            SetStatus("Docker Desktop is required to run Canvix.");
            return;
        }

        SetBusy(true, "Downloading Docker Desktop installer...");
        var installerPath = Path.Combine(Path.GetTempPath(), "Docker Desktop Installer.exe");
        try
        {
            using var response = await DockerHttp.GetAsync(DockerInstallerUrl, HttpCompletionOption.ResponseHeadersRead);
            response.EnsureSuccessStatusCode();
            if (response.Content.Headers.ContentLength is > 1024L * 1024 * 1024)
            {
                throw new InvalidOperationException("The Docker Desktop installer is larger than the safety limit.");
            }

            await using (var input = await response.Content.ReadAsStreamAsync())
            await using (var output = File.Create(installerPath))
            {
                await input.CopyToAsync(output);
            }

            SetStatus("Starting Docker Desktop installer...");
            using var installer = Process.Start(new ProcessStartInfo
            {
                FileName = installerPath,
                UseShellExecute = true,
            });
            if (installer is null)
            {
                throw new InvalidOperationException("Docker Desktop installer could not start.");
            }

            await installer.WaitForExitAsync();
            SetStatus("Docker Desktop setup finished. Start Docker Desktop, then select Start Canvix.");
        }
        catch (Exception ex)
        {
            SetStatus($"Docker Desktop download failed: {ex.Message}");
            OpenUrl(DockerDownloadPageUrl);
        }
        finally
        {
            TryDelete(installerPath);
        }
    }

    private async Task<DockerCommandResult> RunDockerAsync(params string[] arguments)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = "docker",
            WorkingDirectory = _installDirectory,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        foreach (var argument in arguments)
        {
            startInfo.ArgumentList.Add(argument);
        }

        using var process = Process.Start(startInfo) ?? throw new InvalidOperationException("Docker did not start.");
        var outputTask = process.StandardOutput.ReadToEndAsync();
        var errorTask = process.StandardError.ReadToEndAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(30));
        try
        {
            await process.WaitForExitAsync(timeout.Token);
        }
        catch (OperationCanceledException)
        {
            try
            {
                process.Kill(entireProcessTree: true);
            }
            catch (InvalidOperationException)
            {
                // The Docker process already exited while the timeout was handled.
            }

            throw new InvalidOperationException("Docker operation timed out after 30 minutes.");
        }

        return new DockerCommandResult(process.ExitCode, await outputTask, await errorTask);
    }

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
            if (!string.Equals(asset.GetProperty("name").GetString(), InstallerAssetName, StringComparison.Ordinal))
            {
                continue;
            }

            downloadUrl = asset.GetProperty("browser_download_url").GetString();
            break;
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

    private async Task DownloadAndInstallAsync(ReleaseInfo release)
    {
        SetBusy(true, $"Downloading Canvix {release.Version}...");
        var installerPath = Path.Combine(Path.GetTempPath(), $"CanvixSetup-{release.Version}.exe");
        try
        {
            var downloadUri = release.DownloadUri ?? throw new InvalidOperationException("This release has no setup EXE.");
            using var response = await Http.GetAsync(downloadUri, HttpCompletionOption.ResponseHeadersRead);
            response.EnsureSuccessStatusCode();
            if (response.Content.Headers.ContentLength is > 512 * 1024 * 1024)
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

    private async Task RunDockerComposeAsync(params string[] composeArguments)
    {
        if (!File.Exists(ComposePath))
        {
            throw new InvalidOperationException("The Docker Compose file is missing from the installation.");
        }

        var arguments = new List<string> { "compose", "--env-file", EnvPath, "-f", ComposePath };
        arguments.AddRange(composeArguments);
        var result = await RunDockerAsync(arguments.ToArray());
        if (result.ExitCode != 0)
        {
            var details = string.Join(
                Environment.NewLine,
                new[] { result.Error.Trim(), result.Output.Trim() }.Where(text => !string.IsNullOrWhiteSpace(text)));
            if (details.Contains("pull access denied", StringComparison.OrdinalIgnoreCase) ||
                details.Contains("repository does not exist", StringComparison.OrdinalIgnoreCase) ||
                details.Contains("manifest unknown", StringComparison.OrdinalIgnoreCase) ||
                details.Contains("unauthorized", StringComparison.OrdinalIgnoreCase))
            {
                var version = GetEnvironmentValue("CANVIX_VERSION", _currentVersion.ToString(3));
                throw new InvalidOperationException(
                    $"Canvix image {version} is unavailable. Publish the matching GitHub release image, make the GHCR package public, then try again.");
            }

            throw new InvalidOperationException(
                string.IsNullOrWhiteSpace(details) ? "Docker Compose failed." : details);
        }
    }

    private void EnsureEnvironmentFile()
    {
        Directory.CreateDirectory(_dataDirectory);
        var lines = File.Exists(EnvPath) ? File.ReadAllLines(EnvPath).ToList() : [];
        SetEnvironmentLine(lines, "CANVIX_ENV_FILE", ToComposePath(EnvPath));
        SetEnvironmentLine(lines, "CANVIX_VERSION", _currentVersion.ToString(3));
        SetEnvironmentLine(lines, "POSTGRES_DB", "canvix");
        SetEnvironmentLine(lines, "POSTGRES_USER", "canvix");
        SetEnvironmentLine(lines, "WEB_BIND", "127.0.0.1");
        SetEnvironmentLine(lines, "WEB_PORT", "3000");
        if (string.IsNullOrWhiteSpace(GetEnvironmentValue("POSTGRES_PASSWORD", "", lines)))
        {
            SetEnvironmentLine(lines, "POSTGRES_PASSWORD", Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant());
        }

        File.WriteAllLines(EnvPath, lines);
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
        if (index >= 0)
        {
            lines[index] = prefix + value;
        }
        else
        {
            lines.Add(prefix + value);
        }
    }

    private void SetBusy(bool busy, string? status = null)
    {
        _startButton.Enabled = !busy;
        _stopButton.Enabled = !busy;
        _checkButton.Enabled = !busy;
        _progress.Visible = busy;
        if (status is not null)
        {
            SetStatus(status);
        }
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
        client.DefaultRequestHeaders.UserAgent.ParseAdd("CanvixLauncher/0.23.1");
        client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return client;
    }

    private static HttpClient CreateDockerHttpClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromMinutes(30) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("CanvixLauncher/0.23.1");
        return client;
    }

    private static Version GetCurrentVersion()
    {
        var version = Assembly.GetEntryAssembly()?.GetName().Version;
        return version is null ? new Version(0, 23, 1) : new Version(version.Major, version.Minor, Math.Max(version.Build, 0));
    }

    private static string ToComposePath(string path) => path.Replace('\\', '/');

    private static void OpenUrl(string url)
    {
        Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch
        {
            // The temporary installer can be removed by the next update attempt.
        }
    }

    private sealed record ReleaseInfo(Version Version, Uri? DownloadUri);
    private sealed record DockerCommandResult(int ExitCode, string Output, string Error);
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
