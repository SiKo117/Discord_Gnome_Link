import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { getDefaultSocketPath } from './socketUtils.js';

export default class DiscordVoicePanelPreferences extends ExtensionPreferences {
    async fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const defaultPath = getDefaultSocketPath();

        // 1. General Preferences Page
        const page = new Adw.PreferencesPage({
            title: _('Settings'),
            icon_name: 'preferences-other-symbolic',
        });
        window.add(page);

        // --- Taskbar Location & Appearance Group ---
        const locationGroup = new Adw.PreferencesGroup({
            title: _('Taskbar Location & Appearance'),
            description: _('Customize the position and appearance of the extension in the top bar / taskbar'),
        });
        page.add(locationGroup);

        // Position Section (Right / Center / Left)
        const posModel = Gtk.StringList.new([_('Right (Default)'), _('Center'), _('Left')]);
        const posRow = new Adw.ComboRow({
            title: _('Panel Section'),
            subtitle: _('Select which section of the top panel to place the extension in'),
            model: posModel,
        });
        locationGroup.add(posRow);

        const currentPos = settings.get_string('panel-position');
        if (currentPos === 'left') posRow.set_selected(2);
        else if (currentPos === 'center') posRow.set_selected(1);
        else posRow.set_selected(0);

        posRow.connect('notify::selected', () => {
            const idx = posRow.get_selected();
            const val = idx === 2 ? 'left' : (idx === 1 ? 'center' : 'right');
            settings.set_string('panel-position', val);
        });

        // Index SpinRow
        const indexRow = new Adw.SpinRow({
            title: _('Position Order Index'),
            subtitle: _('Order within the section (0 is closest to the corner/edge)'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 50,
                step_increment: 1,
                page_increment: 5,
                value: settings.get_int('panel-index'),
            }),
        });
        locationGroup.add(indexRow);
        settings.bind('panel-index', indexRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        // Taskbar Avatar Size SpinRow
        const iconSizeRow = new Adw.SpinRow({
            title: _('Taskbar Avatar Size'),
            subtitle: _('Diameter in pixels of avatar icons in the top bar (16px to 48px)'),
            adjustment: new Gtk.Adjustment({
                lower: 16,
                upper: 48,
                step_increment: 2,
                page_increment: 4,
                value: settings.get_int('taskbar-icon-size'),
            }),
        });
        locationGroup.add(iconSizeRow);
        settings.bind('taskbar-icon-size', iconSizeRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        // --- Dynamic Display Modes & Stealth Group ---
        const displayGroup = new Adw.PreferencesGroup({
            title: _('Dynamic Display Modes & Feedback'),
            description: _('Configure dynamic display modes, stealth auto-hide, and speaking indicators'),
        });
        page.add(displayGroup);

        // Display Mode ComboRow
        const modeModel = Gtk.StringList.new([
            _('Full Participant Avatars (Default)'),
            _('Minimalist Status Pill'),
            _('Dynamic Speaking-Only Avatars'),
        ]);
        const modeRow = new Adw.ComboRow({
            title: _('Top Panel Display Mode'),
            subtitle: _('Choose how Discord voice status is rendered in the top bar'),
            model: modeModel,
        });
        displayGroup.add(modeRow);

        const currentMode = settings.get_string('panel-display-mode') || 'avatars';
        if (currentMode === 'speaking-only') modeRow.set_selected(2);
        else if (currentMode === 'pill') modeRow.set_selected(1);
        else modeRow.set_selected(0);

        modeRow.connect('notify::selected', () => {
            const idx = modeRow.get_selected();
            const val = idx === 2 ? 'speaking-only' : (idx === 1 ? 'pill' : 'avatars');
            settings.set_string('panel-display-mode', val);
        });

        // Stealth Mode SwitchRow
        const stealthRow = new Adw.SwitchRow({
            title: _('Stealth Mode (Auto-Hide When Idle)'),
            subtitle: _('Completely conceal the indicator from the top bar when not connected to an active voice room'),
        });
        displayGroup.add(stealthRow);
        settings.bind('stealth-mode', stealthRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        // Speaking Glow Color Entry
        const glowColorRow = new Adw.EntryRow({
            title: _('Speaking Glow Halo Color'),
            text: settings.get_string('speaking-glow-color') || '#23a55a',
        });
        displayGroup.add(glowColorRow);
        settings.bind('speaking-glow-color', glowColorRow, 'text', Gio.SettingsBindFlags.DEFAULT);

        // Show Voice Participants in Taskbar SwitchRow
        const participantsRow = new Adw.SwitchRow({
            title: _('Show Voice Participants in Taskbar'),
            subtitle: _('Display active channel participants’ circular avatar icons in the top panel'),
        });
        displayGroup.add(participantsRow);
        settings.bind('show-taskbar-participants', participantsRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        // Max Participant Avatars SpinRow
        const maxParticipantsRow = new Adw.SpinRow({
            title: _('Max Taskbar Participant Avatars'),
            subtitle: _('Limit how many voice participant avatar icons appear in the top panel (1 to 10)'),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 10,
                step_increment: 1,
                page_increment: 2,
                value: settings.get_int('taskbar-max-participants'),
            }),
        });
        displayGroup.add(maxParticipantsRow);
        settings.bind('taskbar-max-participants', maxParticipantsRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        maxParticipantsRow.set_sensitive(settings.get_boolean('show-taskbar-participants'));
        participantsRow.connect('notify::active', () => {
            maxParticipantsRow.set_sensitive(participantsRow.get_active());
        });

        // Only profile picture in taskbar switch
        const avatarOnlyRow = new Adw.SwitchRow({
            title: _('Avatar-Only Mode in Taskbar'),
            subtitle: _('Display only avatar icons without the numeric count text label in the taskbar'),
        });
        displayGroup.add(avatarOnlyRow);
        settings.bind('taskbar-avatar-only', avatarOnlyRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        // Show avatar when disconnected
        const disconnectedRow = new Adw.SwitchRow({
            title: _('Show When Disconnected'),
            subtitle: _('Keep the profile avatar visible (dimmed) in the panel even when Discord is disconnected (overridden by Stealth Mode)'),
        });
        displayGroup.add(disconnectedRow);
        settings.bind('show-disconnected-icon', disconnectedRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        // Show member count badge
        const countRow = new Adw.SwitchRow({
            title: _('Show Voice Member Count Badge'),
            subtitle: _('Display participant count next to avatar when not in avatar-only mode'),
        });
        displayGroup.add(countRow);
        settings.bind('show-member-count', countRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        // --- Quick Mouse Actions Group ---
        const mouseGroup = new Adw.PreferencesGroup({
            title: _('Quick Mouse Actions'),
            description: _('Customize what mouse clicks and scroll actions on the top panel button do'),
        });
        page.add(mouseGroup);

        const mouseActionValues = ['toggle-mute', 'toggle-deaf', 'leave-channel', 'cycle-display-mode', 'toggle-menu', 'none'];
        const mouseActionLabels = [
            _('Toggle Mute'),
            _('Toggle Deafen'),
            _('Leave Voice Channel'),
            _('Cycle Display Mode'),
            _('Open / Close Menu'),
            _('Disabled (None)'),
        ];

        // Middle-Click Action ComboRow
        const midActionModel = Gtk.StringList.new(mouseActionLabels);
        const midActionRow = new Adw.ComboRow({
            title: _('Middle-Click Action'),
            subtitle: _('Action executed when clicking with the middle mouse button'),
            model: midActionModel,
        });
        mouseGroup.add(midActionRow);

        const currentMid = settings.get_string('mouse-middle-click-action') || 'toggle-mute';
        const midIndex = mouseActionValues.indexOf(currentMid);
        midActionRow.set_selected(midIndex >= 0 ? midIndex : 0);

        midActionRow.connect('notify::selected', () => {
            const idx = midActionRow.get_selected();
            settings.set_string('mouse-middle-click-action', mouseActionValues[idx] || 'toggle-mute');
        });

        // Right-Click Action ComboRow
        const rightActionModel = Gtk.StringList.new(mouseActionLabels);
        const rightActionRow = new Adw.ComboRow({
            title: _('Right-Click Action'),
            subtitle: _('Action executed when clicking with the right mouse button'),
            model: rightActionModel,
        });
        mouseGroup.add(rightActionRow);

        const currentRight = settings.get_string('mouse-right-click-action') || 'leave-channel';
        const rightIndex = mouseActionValues.indexOf(currentRight);
        rightActionRow.set_selected(rightIndex >= 0 ? rightIndex : 2);

        rightActionRow.connect('notify::selected', () => {
            const idx = rightActionRow.get_selected();
            settings.set_string('mouse-right-click-action', mouseActionValues[idx] || 'leave-channel');
        });

        // Scroll Action ComboRow
        const scrollActionValues = ['cycle-display-mode', 'toggle-mute', 'none'];
        const scrollActionLabels = [
            _('Cycle Display Mode (Default)'),
            _('Toggle Mute / Unmute'),
            _('Disabled (None)'),
        ];
        const scrollActionModel = Gtk.StringList.new(scrollActionLabels);
        const scrollActionRow = new Adw.ComboRow({
            title: _('Scroll Wheel Action'),
            subtitle: _('Action executed when scrolling up or down on the panel indicator'),
            model: scrollActionModel,
        });
        mouseGroup.add(scrollActionRow);

        const currentScroll = settings.get_string('mouse-scroll-action') || 'cycle-display-mode';
        const scrollIndex = scrollActionValues.indexOf(currentScroll);
        scrollActionRow.set_selected(scrollIndex >= 0 ? scrollIndex : 0);

        scrollActionRow.connect('notify::selected', () => {
            const idx = scrollActionRow.get_selected();
            settings.set_string('mouse-scroll-action', scrollActionValues[idx] || 'cycle-display-mode');
        });

        // --- Manual Connection Group ---
        const connGroup = new Adw.PreferencesGroup({
            title: _('Manual Discord IPC Connection'),
            description: _('Configure the Unix domain socket path used to connect to your Discord client'),
        });
        page.add(connGroup);

        // Manual Socket Path Entry
        const manualPathRow = new Adw.EntryRow({
            title: _('Socket Path'),
            text: settings.get_string('manual-socket-path') || defaultPath,
        });
        connGroup.add(manualPathRow);
        settings.bind('manual-socket-path', manualPathRow, 'text', Gio.SettingsBindFlags.DEFAULT);

        // Reset to default socket path helper row
        const defaultRow = new Adw.ActionRow({
            title: _('Default Socket Path'),
            subtitle: defaultPath,
        });
        const resetBtn = new Gtk.Button({
            label: _('Reset to Default'),
            valign: Gtk.Align.CENTER,
        });
        resetBtn.connect('clicked', () => {
            manualPathRow.set_text(defaultPath);
            settings.set_string('manual-socket-path', defaultPath);
        });
        defaultRow.add_suffix(resetBtn);
        connGroup.add(defaultRow);

        // Connect on startup switch
        const startupRow = new Adw.SwitchRow({
            title: _('Connect on Extension Startup'),
            subtitle: _('If turned off, Discord remains disconnected until you manually click "Connect" in the top panel'),
        });
        connGroup.add(startupRow);
        settings.bind('connect-on-startup', startupRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        // Client ID
        const clientIdRow = new Adw.EntryRow({
            title: _('Discord Client ID'),
            text: settings.get_string('client-id') || '207646673902501888',
        });
        connGroup.add(clientIdRow);
        settings.bind('client-id', clientIdRow, 'text', Gio.SettingsBindFlags.DEFAULT);

        // Access Token
        const tokenRow = new Adw.PasswordEntryRow({
            title: _('RPC Access Token'),
        });
        tokenRow.set_text(settings.get_string('access-token'));
        connGroup.add(tokenRow);
        settings.bind('access-token', tokenRow, 'text', Gio.SettingsBindFlags.DEFAULT);

        // Authorization info action row
        const authStatusRow = new Adw.ActionRow({
            title: _('Voice Authorization'),
            subtitle: settings.get_string('access-token')
                ? _('✓ Authorized (Access token configured)')
                : _('Click "Authorize Voice Access" in the top panel to grant voice permissions'),
        });
        connGroup.add(authStatusRow);

        const tokenChangedId = settings.connect('changed::access-token', () => {
            const hasToken = Boolean(settings.get_string('access-token'));
            authStatusRow.set_subtitle(
                hasToken
                    ? _('✓ Authorized (Access token configured)')
                    : _('Click "Authorize Voice Access" in the top panel to grant voice permissions')
            );
        });

        window.connect('close-request', () => {
            if (tokenChangedId) {
                settings.disconnect(tokenChangedId);
            }
            return false;
        });

        // --- Manual Connection Guide & Setup Group ---
        const helpGroup = new Adw.PreferencesGroup({
            title: _('Manual Connection Guide & Setup'),
            description: _('How to locate and connect your Discord socket on Linux'),
        });
        page.add(helpGroup);

        const nativeRow = new Adw.ActionRow({
            title: _('Native Discord (deb / rpm / Arch)'),
            subtitle: _('Socket is typically at: /run/user/<UID>/discord-ipc-0 (check with: ls -l $XDG_RUNTIME_DIR/discord-ipc*)'),
        });
        helpGroup.add(nativeRow);

        const flatpakRow = new Adw.ActionRow({
            title: _('Official Flatpak Discord Permission'),
            subtitle: _('Run in terminal: flatpak override --user --filesystem=xdg-run/discord-ipc-* com.discordapp.Discord'),
        });
        helpGroup.add(flatpakRow);

        const arRpcInfoRow = new Adw.ActionRow({
            title: _('About Vesktop / arRPC'),
            subtitle: _('Vesktop uses arRPC solely for Rich Presence (games). arRPC does not implement Discord Voice RPC. Official Discord Desktop is required for voice status.'),
        });
        helpGroup.add(arRpcInfoRow);

        const devPortalRow = new Adw.ActionRow({
            title: _('Discord Developer Portal'),
            subtitle: _('Configure your own Application ID or OAuth2 scopes if needed'),
        });
        const openLinkButton = new Gtk.Button({
            icon_name: 'adw-external-link-symbolic',
            valign: Gtk.Align.CENTER,
            has_frame: false,
        });
        openLinkButton.connect('clicked', () => {
            try {
                Gio.AppInfo.launch_default_for_uri('https://discord.com/developers/applications', null);
            } catch (err) {
                console.error(`[DiscordVoice] Failed to launch URI: ${err}`);
            }
        });
        devPortalRow.add_suffix(openLinkButton);
        helpGroup.add(devPortalRow);
    }
}
