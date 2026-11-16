using Microsoft.Win32;
using System.Diagnostics;
using System.Reflection;

namespace CanvixSetupBootstrapper;

internal static class Program
{
    [STAThread]
    private static int Main()
    {
        ApplicationConfiguration.Initialize();
        var id = Guid.NewGuid().ToString("N");
        var msiPath = Path.Combine(Path.GetTempPath(), $"CanvixSetup-{id}.msi");
        var logPath = Path.Combine(Path.GetTempPath(), $"CanvixSetup-{id}.log");
        try
        {
            ExtractMsi(msiPath);
            var installedProducts = FindInstalledProducts();
            if (installedProducts.Count > 0)
            {
                var choice = MessageBox.Show(
                    "An older Canvix installation was found. Remove its program files and install this version?\n\nYour local data in %ProgramData%\\Canvix will be kept.",
                    "Canvix setup",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Warning);
                if (choice != DialogResult.Yes)
                {
                    return 2;
                }

                StopInstalledLaunchers();
                foreach (var product in installedProducts)
                {
                    UninstallProduct(product, id);
                }
            }

            using var installer = Process.Start(new ProcessStartInfo
            {
                FileName = "msiexec.exe",
                Arguments = $"/i \"{msiPath}\" /l*v \"{logPath}\"",
                UseShellExecute = true,
            });
            if (installer is null)
            {
                throw new InvalidOperationException("Windows Installer could not start.");
            }

            installer.WaitForExit();
            if (installer.ExitCode != 0)
            {
                MessageBox.Show(
                    $"Canvix installation did not complete. Windows Installer returned {installer.ExitCode}.\n\nInstaller log: {logPath}",
                    "Canvix setup",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                return installer.ExitCode;
            }

            var launcherPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                "Canvix",
                "CanvixLauncher.exe");
            if (File.Exists(launcherPath))
            {
                Process.Start(new ProcessStartInfo { FileName = launcherPath, UseShellExecute = true });
            }

            return 0;
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                ex.Message,
                "Canvix setup",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 1;
        }
        finally
        {
            TryDelete(msiPath);
        }
    }

    private static IReadOnlyList<InstalledProduct> FindInstalledProducts()
    {
        var products = new Dictionary<string, InstalledProduct>(StringComparer.OrdinalIgnoreCase);
        foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
        {
            using var root = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, view);
            using var uninstall = root.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall");
            if (uninstall is null) continue;

            foreach (var subkeyName in uninstall.GetSubKeyNames())
            {
                if (!Guid.TryParse(subkeyName, out var productCode)) continue;
                using var product = uninstall.OpenSubKey(subkeyName);
                var displayName = product?.GetValue("DisplayName") as string;
                if (string.IsNullOrWhiteSpace(displayName) ||
                    !displayName.StartsWith("Canvix", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                var code = productCode.ToString("B").ToUpperInvariant();
                products[code] = new InstalledProduct(code, displayName);
            }
        }

        return products.Values.ToArray();
    }

    private static void StopInstalledLaunchers()
    {
        var installRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            "Canvix");
        foreach (var process in Process.GetProcessesByName("CanvixLauncher"))
        {
            try
            {
                var executable = process.MainModule?.FileName;
                if (executable is not null && executable.StartsWith(installRoot, StringComparison.OrdinalIgnoreCase))
                {
                    process.Kill(entireProcessTree: true);
                    process.WaitForExit(10_000);
                }
            }
            catch
            {
                // Windows Installer will report a locked file if the process cannot stop.
            }
            finally
            {
                process.Dispose();
            }
        }
    }

    private static void UninstallProduct(InstalledProduct product, string id)
    {
        var logPath = Path.Combine(Path.GetTempPath(), $"CanvixUninstall-{id}-{product.ProductCode.Trim('{', '}')}.log");
        using var uninstaller = Process.Start(new ProcessStartInfo
        {
            FileName = "msiexec.exe",
            Arguments = $"/x {product.ProductCode} /qn /norestart /l*v \"{logPath}\"",
            UseShellExecute = true,
        });
        if (uninstaller is null)
        {
            throw new InvalidOperationException($"Windows Installer could not remove {product.DisplayName}.");
        }

        uninstaller.WaitForExit();
        if (uninstaller.ExitCode != 0)
        {
            throw new InvalidOperationException(
                $"Could not remove {product.DisplayName}. Windows Installer returned {uninstaller.ExitCode}.\n\nUninstall log: {logPath}");
        }
    }

    private static void ExtractMsi(string destination)
    {
        using var input = Assembly.GetExecutingAssembly().GetManifestResourceStream("CanvixSetup.msi")
            ?? throw new InvalidOperationException("The embedded Canvix MSI is missing.");
        using var output = File.Create(destination);
        input.CopyTo(output);
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch
        {
            // Windows Installer can still hold the temporary MSI briefly.
        }
    }

    private sealed record InstalledProduct(string ProductCode, string DisplayName);
}
