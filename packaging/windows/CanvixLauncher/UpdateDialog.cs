namespace CanvixLauncher;

internal sealed class UpdateDialog : Form
{
    public UpdateDialog(IReadOnlyList<RuntimeUpdateInfo> updates, string messageText)
    {
        Text = "Canvix updates";
        StartPosition = FormStartPosition.CenterParent;
        ClientSize = new Size(720, 280);
        MinimizeBox = false;
        MaximizeBox = false;
        ShowInTaskbar = false;

        var grid = new DataGridView
        {
            Dock = DockStyle.Fill,
            ReadOnly = true,
            AllowUserToAddRows = false,
            AllowUserToDeleteRows = false,
            AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill,
            RowHeadersVisible = false,
            SelectionMode = DataGridViewSelectionMode.FullRowSelect,
        };
        grid.Columns.Add("component", "Component");
        grid.Columns.Add("installed", "Installed version");
        grid.Columns.Add("available", "Latest version");
        foreach (var update in updates)
        {
            var latest = update.Status switch
            {
                "latest" => "Latest",
                "pinned" => "Pinned",
                "required" => "Docker required",
                _ when update.Status.StartsWith("check failed", StringComparison.Ordinal) => "Unavailable",
                _ => update.AvailableVersion,
            };
            grid.Rows.Add(update.Component, update.InstalledVersion, latest);
        }

        var message = new Label
        {
            Text = messageText,
            AutoSize = true,
            Dock = DockStyle.Fill,
        };
        var updateButton = new Button
        {
            Text = updates.Any(update => update.CanUpdate) ? "Yes" : "Close",
            AutoSize = true,
            DialogResult = updates.Any(update => update.CanUpdate) ? DialogResult.Yes : DialogResult.Cancel,
        };
        var cancelButton = new Button
        {
            Text = "No",
            AutoSize = true,
            DialogResult = DialogResult.Cancel,
            Visible = updates.Any(update => update.CanUpdate),
        };
        var buttons = new FlowLayoutPanel
        {
            AutoSize = true,
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.RightToLeft,
        };
        buttons.Controls.Add(cancelButton);
        buttons.Controls.Add(updateButton);

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(12),
            ColumnCount = 1,
            RowCount = 3,
        };
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.Controls.Add(grid, 0, 0);
        layout.Controls.Add(message, 0, 1);
        layout.Controls.Add(buttons, 0, 2);
        Controls.Add(layout);
        AcceptButton = updateButton;
        CancelButton = cancelButton;
    }
}
