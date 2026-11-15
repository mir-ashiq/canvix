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
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch
        {
            // Windows Installer can still hold the temporary MSI briefly.
        }
    }
}
