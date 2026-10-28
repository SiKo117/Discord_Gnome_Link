import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import { formatSocketName } from './socketUtils.js';
import { getAvatarManager, AvatarWidget } from './avatarManager.js';

export const DiscordVoiceIndicator = GObject.registerClass(
class DiscordVoiceIndicator extends PanelMenu.Button {
    _init(extension, rpcClient) {
        super._init(0.0, _('Discord Voice'), false);

        // GNOME Shell 47-51 Compatibility:
        // PanelMenu.Button sets up this._clickGesture with default required_button = 0 (any button).
        // Restrict this._clickGesture strictly to primary click (button 1) so buttons 2 and 3 do not toggle menu.
        if (this._clickGesture) {
            if (typeof this._clickGesture.set_required_button === 'function') {
                this._clickGesture.set_required_button(1);
            } else {
                try {
                    this._clickGesture.required_button = 1;
                } catch (_) {}
            }
        }

        this._extension = extension;
        this._settings = extension.getSettings();
        this._rpc = rpcClient;
        this._avatarManager = getAvatarManager();

        this._suppressMuteToggle = false;
        this._suppressDeafToggle = false;
        this._rpcUnsubscribers = [];
        this._participantWidgets = [];
        this._participantWidgetMap = new Map();
        this._memberItemWidgets = new Map();
        this._userVolumeSettings = new Map(); // userId -> { volume: number, mute: boolean }
        this._expandedUsers = new Set(); // set of userIds with expanded volume controls

        this._speakingGlowColor = this._settings?.get_string('speaking-glow-color') || '#23a55a';

        // 1. Build Panel UI (Taskbar: Profile Picture Avatar, Minimalist Pill, etc.)
        this._buildPanelUi();

        // 2. Build Dedicated Popup Menu UI
        this._buildMenuUi();

        // 3. Bind Extension Settings
        this._bindSettings();

        // 4. Hook RPC Events
        this._bindRpcEvents();

        // Refresh dynamic connection submenu when opened
        this._menuOpenId = this.menu.connect('open-state-changed', (menu, isOpen) => {
            if (isOpen) {
                this._refreshConnSubMenu();
                const channel = this._rpc.currentVoiceChannel;
                if (channel && channel.guild_id) {
                    this._refreshChannelSubMenu(channel.guild_id, channel.id);
                }
            }
        });

        // Initial render
        this._updateUi();
    }

    _getTaskbarIconSize() {
        return Math.max(16, Math.min(48, this._settings?.get_int('taskbar-icon-size') || 28));
    }

    /**
     * Build the taskbar indicator.
     * Supports Avatar mode, Participant avatars, and Minimalist Pill mode.
     */
    _buildPanelUi() {
        this._panelBox = new St.BoxLayout({
            style_class: 'panel-status-indicators-box discord-panel-box',
            y_align: Clutter.ActorAlign.CENTER,
        });

        const iconSize = this._getTaskbarIconSize();

        // Circular profile picture widget in the taskbar
        this._taskbarAvatar = new AvatarWidget(this._avatarManager, iconSize, {
            style_class: 'discord-panel-avatar',
            fallbackIcon: 'avatar-default-symbolic',
            glowColor: this._speakingGlowColor,
        });
        this._panelBox.add_child(this._taskbarAvatar);

        // Container for other voice participants' avatars
        this._taskbarParticipantsBox = new St.BoxLayout({
            style_class: 'discord-taskbar-participants-box',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._panelBox.add_child(this._taskbarParticipantsBox);

        // Optional participant overflow badge (+N)
        this._taskbarOverflowLabel = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'discord-taskbar-overflow-badge',
            visible: false,
        });
        this._panelBox.add_child(this._taskbarOverflowLabel);

        // Optional member count label (hidden in avatar-only mode)
        this._countLabel = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'discord-panel-count-label',
        });
        this._panelBox.add_child(this._countLabel);

        // Minimalist Status Pill Box (used when panel-display-mode === 'pill')
        this._pillBox = new St.BoxLayout({
            style_class: 'discord-panel-pill',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this._pillIcon = new St.Icon({
            icon_name: 'audio-headset-symbolic',
            icon_size: 14,
        });
        this._pillLabel = new St.Label({
            text: 'Discord',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._pillBox.add_child(this._pillIcon);
        this._pillBox.add_child(this._pillLabel);
        this._panelBox.add_child(this._pillBox);

        this.add_child(this._panelBox);
    }

    /**
     * Primary event handler overriding PanelMenu.Button.
     * In GNOME Shell, PanelMenu.Button.prototype.vfunc_event intercepts BUTTON_PRESS
     * unconditionally and calls this.menu.toggle() for any button.
     * We intercept Clutter.EventType.BUTTON_PRESS for buttons 2 and 3 and execute
     * custom quick mouse actions, returning Clutter.EVENT_STOP.
     * Button 1 (left click) and 'toggle-menu' actions are forwarded to super.vfunc_event.
     * Also handles Clutter.EventType.SCROLL including smooth scroll deltas.
     */
    vfunc_event(event) {
        const eventType = event.type();

        if (eventType === Clutter.EventType.BUTTON_PRESS) {
            const button = event.get_button();
            if (button === 2) {
                // Middle-click: always intercept and stop propagation
                const action = this._settings?.get_string('mouse-middle-click-action') || 'toggle-mute';
                if (action === 'toggle-menu') {
                    this.menu?.toggle();
                } else if (action !== 'none') {
                    this._executeMouseAction(action);
                }
                return Clutter.EVENT_STOP;
            } else if (button === 3) {
                // Right-click: always intercept and stop propagation
                const action = this._settings?.get_string('mouse-right-click-action') || 'leave-channel';
                if (action === 'toggle-menu') {
                    this.menu?.toggle();
                } else if (action !== 'none') {
                    this._executeMouseAction(action);
                }
                return Clutter.EVENT_STOP;
            } else if (button === 1) {
                // Left-click - standard menu toggle
                return super.vfunc_event(event);
            }
        } else if (eventType === Clutter.EventType.BUTTON_RELEASE) {
            const button = event.get_button();
            if (button === 2 || button === 3) {
                return Clutter.EVENT_STOP;
            }
        } else if (eventType === Clutter.EventType.SCROLL) {
            let direction = event.get_scroll_direction();
            if (direction === Clutter.ScrollDirection.SMOOTH) {
                const [dx, dy] = event.get_scroll_delta();
                if (Math.abs(dy) >= 0.1 || Math.abs(dx) >= 0.1) {
                    if (dy < 0 || dx < 0) {
                        direction = Clutter.ScrollDirection.UP;
                    } else if (dy > 0 || dx > 0) {
                        direction = Clutter.ScrollDirection.DOWN;
                    }
                }
            }
            const action = this._settings?.get_string('mouse-scroll-action') || 'cycle-display-mode';
            if (action !== 'none') {
                this._executeScrollAction(action, direction);
            }
            return Clutter.EVENT_STOP;
        }

        return super.vfunc_event(event);
    }

    /**
     * Compatibility handlers for direct button press / release / scroll calls.
     */
    vfunc_button_press_event(event) {
        return this.vfunc_event(event);
    }

    vfunc_button_release_event(event) {
        return this.vfunc_event(event);
    }

    vfunc_scroll_event(event) {
        return this.vfunc_event(event);
    }

    _executeMouseAction(action) {
        if (!action || action === 'none') return false;

        switch (action) {
            case 'toggle-mute': {
                const currentMute = Boolean(this._rpc.currentVoiceSettings?.mute);
                this._rpc.setVoiceSettings({ mute: !currentMute }).catch(e => {
                    console.warn(`[DiscordVoice] Quick mouse toggle mute failed: ${e.message}`);
                });
                return true;
            }
            case 'toggle-deaf': {
                const currentDeaf = Boolean(this._rpc.currentVoiceSettings?.deaf);
                this._rpc.setVoiceSettings({ deaf: !currentDeaf }).catch(e => {
                    console.warn(`[DiscordVoice] Quick mouse toggle deaf failed: ${e.message}`);
                });
                return true;
            }
            case 'leave-channel': {
                this._clearTaskbarParticipants();
                this._rpc.selectVoiceChannel(null).catch(e => {
                    console.warn(`[DiscordVoice] Quick mouse leave failed: ${e.message}`);
                });
                return true;
            }
            case 'cycle-display-mode': {
                const modes = ['avatars', 'pill', 'speaking-only'];
                const current = this._settings?.get_string('panel-display-mode') || 'avatars';
                const nextIndex = (modes.indexOf(current) + 1) % modes.length;
                this._settings?.set_string('panel-display-mode', modes[nextIndex]);
                return true;
            }
            case 'toggle-menu': {
                this.menu.toggle();
                return true;
            }
            default:
                return false;
        }
    }

    _executeScrollAction(action, direction) {
        if (!action || action === 'none') return false;

        let isUp = false;
        let isDown = false;

        if (direction === Clutter.ScrollDirection.UP) {
            isUp = true;
        } else if (direction === Clutter.ScrollDirection.DOWN) {
            isDown = true;
        }

        if (!isUp && !isDown) return false;

        if (action === 'cycle-display-mode') {
            const modes = ['avatars', 'pill', 'speaking-only'];
            const current = this._settings?.get_string('panel-display-mode') || 'avatars';
            let nextIndex;
            if (isUp) {
                nextIndex = (modes.indexOf(current) - 1 + modes.length) % modes.length;
            } else {
                nextIndex = (modes.indexOf(current) + 1) % modes.length;
            }
            this._settings?.set_string('panel-display-mode', modes[nextIndex]);
            return true;
        }

        if (action === 'toggle-mute') {
            if (isUp) {
                this._rpc.setVoiceSettings({ mute: false }).catch(() => {});
                return true;
            } else {
                this._rpc.setVoiceSettings({ mute: true }).catch(() => {});
                return true;
            }
        }

        return false;
    }

    /**
     * Build the dedicated Discord popup menu window.
     */
    _buildMenuUi() {
        // --- 1. User Profile & Status Header Card ---
        this._headerCardItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'discord-popup-card-item',
        });

        const headerBox = new St.BoxLayout({
            style_class: 'discord-header-card',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        // Header User Avatar (40px)
        this._headerAvatar = new AvatarWidget(this._avatarManager, 40, {
            style_class: 'discord-header-avatar',
            fallbackIcon: 'avatar-default-symbolic',
            glowColor: this._speakingGlowColor,
        });
        headerBox.add_child(this._headerAvatar);

        // User info & status column
        const headerInfoBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'discord-header-info',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._headerName = new St.Label({
            text: _('Discord Voice'),
            style_class: 'discord-header-username',
        });
        headerInfoBox.add_child(this._headerName);

        const statusRow = new St.BoxLayout({
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'discord-header-status-row',
        });

        this._headerStatusDot = new St.Bin({
            style_class: 'discord-status-dot is-disconnected',
        });
        statusRow.add_child(this._headerStatusDot);

        this._headerStatusLabel = new St.Label({
            text: _('Disconnected'),
            style_class: 'discord-header-status-text',
        });
        statusRow.add_child(this._headerStatusLabel);

        headerInfoBox.add_child(statusRow);
        headerBox.add_child(headerInfoBox);

        // Settings gear button
        const settingsBtn = new St.Button({
            style_class: 'discord-icon-button discord-header-settings-btn',
            can_focus: true,
            child: new St.Icon({
                icon_name: 'emblem-system-symbolic',
                icon_size: 16,
            }),
        });
        settingsBtn.connect('clicked', () => {
            this.menu.close();
            this._extension.openPreferences();
        });
        headerBox.add_child(settingsBtn);

        this._headerCardItem.add_child(headerBox);
        this.menu.addMenuItem(this._headerCardItem);

        // --- 2. Notice Banners (arRPC / Auth / Info) ---
        this._authNoticeItem = new PopupMenu.PopupMenuItem(
            _('ℹ Discord requires one-time approval to read voice channels and control mute/deafen.'),
            { reactive: false, style_class: 'discord-auth-notice' }
        );
        this._authNoticeItem.label.clutter_text.set_line_wrap(true);
        this._authNoticeItem.visible = false;
        this.menu.addMenuItem(this._authNoticeItem);

        this._arRpcNoticeItem = new PopupMenu.PopupMenuItem(
            _('⚠ Connected socket is arRPC (Rich Presence only). Voice features require Official Discord Desktop.'),
            { reactive: false, style_class: 'discord-arrpc-notice' }
        );
        this._arRpcNoticeItem.label.clutter_text.set_line_wrap(true);
        this._arRpcNoticeItem.visible = false;
        this.menu.addMenuItem(this._arRpcNoticeItem);

        // --- 3. Prominent Action Buttons (Connect / Authorize) ---
        this._connectItem = new PopupMenu.PopupMenuItem(_('🔌 Connect to Discord'), {
            style_class: 'discord-connect-button',
        });
        this._connectItemId = this._connectItem.connect('activate', () => {
            this._headerStatusLabel.text = _('Connecting to Discord...');
            this._rpc.connect();
        });
        this.menu.addMenuItem(this._connectItem);

        this._authItem = new PopupMenu.PopupMenuItem(_('🔑 Authorize Voice Access (1-Click)'), {
            style_class: 'discord-auth-button',
        });
        this._authItemId = this._authItem.connect('activate', async () => {
            try {
                this._authItem.label.text = _('⏳ Check Discord to approve...');
                this._headerStatusLabel.text = _('Waiting for Discord authorization...');
                await this._rpc.authorize({ prompt: 'consent' });
            } catch (err) {
                console.warn(`[DiscordVoice] Authorization error: ${err.message}`);
                this._authItem.label.text = _('🔑 Authorize Voice Access (1-Click)');
                this._headerStatusLabel.text = _('Authorization not completed');
            }
        });
        this._authItem.visible = false;
        this.menu.addMenuItem(this._authItem);

        // --- 4. Active Voice Channel Card & Toolbar ---
        this._voiceCardItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'discord-popup-card-item',
        });

        const voiceCardBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'discord-voice-channel-card',
        });

        // Channel header row (🔊 Channel Name + RTC Badge)
        const channelHeaderRow = new St.BoxLayout({
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'discord-channel-header-row',
        });

        this._channelTitleLabel = new St.Label({
            text: _('🔊 Voice Channel'),
            style_class: 'discord-channel-name',
            x_expand: true,
        });
        channelHeaderRow.add_child(this._channelTitleLabel);

        const rtcBadge = new St.BoxLayout({
            style_class: 'discord-rtc-badge',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const rtcDot = new St.Bin({ style_class: 'discord-status-dot is-connected' });
        const rtcText = new St.Label({ text: _('RTC Connected'), style_class: 'discord-rtc-text' });
        rtcBadge.add_child(rtcDot);
        rtcBadge.add_child(rtcText);
        channelHeaderRow.add_child(rtcBadge);

        voiceCardBox.add_child(channelHeaderRow);

        // Dedicated Voice Action Controls Toolbar
        const controlsToolbar = new St.BoxLayout({
            x_expand: true,
            style_class: 'discord-controls-toolbar',
        });

        // Mute Button
        this._muteBtn = new St.Button({
            style_class: 'discord-toolbar-btn',
            can_focus: true,
            x_expand: true,
        });
        const muteBox = new St.BoxLayout({
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._muteIcon = new St.Icon({
            icon_name: 'audio-input-microphone-symbolic',
            icon_size: 16,
            style_class: 'discord-btn-icon',
        });
        this._muteText = new St.Label({
            text: _('Mute'),
            style_class: 'discord-btn-label',
        });
        muteBox.add_child(this._muteIcon);
        muteBox.add_child(this._muteText);
        this._muteBtn.set_child(muteBox);
        this._muteBtn.connect('clicked', () => {
            if (this._suppressMuteToggle) return;
            const currentMute = Boolean(this._rpc.currentVoiceSettings?.mute);
            this._rpc.setVoiceSettings({ mute: !currentMute }).catch(e => {
                console.warn(`[DiscordVoice] Failed to toggle mute: ${e.message}`);
            });
        });
        controlsToolbar.add_child(this._muteBtn);

        // Deafen Button
        this._deafBtn = new St.Button({
            style_class: 'discord-toolbar-btn',
            can_focus: true,
            x_expand: true,
        });
        const deafBox = new St.BoxLayout({
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._deafIcon = new St.Icon({
            icon_name: 'audio-headset-symbolic',
            icon_size: 16,
            style_class: 'discord-btn-icon',
        });
        this._deafText = new St.Label({
            text: _('Deafen'),
            style_class: 'discord-btn-label',
        });
        deafBox.add_child(this._deafIcon);
        deafBox.add_child(this._deafText);
        this._deafBtn.set_child(deafBox);
        this._deafBtn.connect('clicked', () => {
            if (this._suppressDeafToggle) return;
            const currentDeaf = Boolean(this._rpc.currentVoiceSettings?.deaf);
            this._rpc.setVoiceSettings({ deaf: !currentDeaf }).catch(e => {
                console.warn(`[DiscordVoice] Failed to toggle deaf: ${e.message}`);
            });
        });
        controlsToolbar.add_child(this._deafBtn);

        // Leave Voice Channel Button (Red Hangup)
        this._disconnectVoiceBtn = new St.Button({
            style_class: 'discord-toolbar-btn is-leave',
            can_focus: true,
            x_expand: true,
        });
        const leaveBox = new St.BoxLayout({
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const leaveIcon = new St.Icon({
            icon_name: 'call-stop-symbolic',
            icon_size: 16,
            style_class: 'discord-btn-icon',
        });
        const leaveText = new St.Label({
            text: _('Leave'),
            style_class: 'discord-btn-label',
        });
        leaveBox.add_child(leaveIcon);
        leaveBox.add_child(leaveText);
        this._disconnectVoiceBtn.set_child(leaveBox);
        this._disconnectVoiceBtn.connect('clicked', () => {
            this._clearTaskbarParticipants();
            this._rpc.selectVoiceChannel(null).catch(err => {
                console.warn(`[DiscordVoice] Leave channel failed: ${err.message}`);
            });
        });
        controlsToolbar.add_child(this._disconnectVoiceBtn);

        voiceCardBox.add_child(controlsToolbar);
        this._voiceCardItem.add_child(voiceCardBox);
        this._voiceCardItem.visible = false;
        this.menu.addMenuItem(this._voiceCardItem);

        // --- 4.5 Quick Voice Channel Hopping Submenu ---
        this._channelSubMenu = new PopupMenu.PopupSubMenuMenuItem(_('Switch Voice Channel'));
        this._channelSubMenu.visible = false;
        this.menu.addMenuItem(this._channelSubMenu);

        // --- 5. Empty State / Not in Channel Item ---
        this._notInVoiceItem = new PopupMenu.PopupMenuItem(_('Not in a voice channel'), {
            reactive: false,
            style_class: 'discord-empty-members-label',
        });
        this.menu.addMenuItem(this._notInVoiceItem);

        // --- 6. Dynamic Voice Channel Member Section ---
        this._memberSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._memberSection);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // --- 7. Manual Connection Controls Submenu ---
        this._connSubMenu = new PopupMenu.PopupSubMenuMenuItem(_('Connection Details'));
        this.menu.addMenuItem(this._connSubMenu);
        this._refreshConnSubMenu();

        // --- 8. Preferences Action ---
        const settingsItem = new PopupMenu.PopupMenuItem(_('Extension Settings...'));
        settingsItem.connect('activate', () => {
            this._extension.openPreferences();
        });
        this.menu.addMenuItem(settingsItem);
    }

    _bindSettings() {
        if (!this._settings) return;

        this._settingsChangedId = this._settings.connect('changed', (s, key) => {
            if (
                key === 'show-member-count' ||
                key === 'show-disconnected-icon' ||
                key === 'taskbar-avatar-only' ||
                key === 'taskbar-icon-size' ||
                key === 'show-taskbar-participants' ||
                key === 'taskbar-max-participants' ||
                key === 'manual-socket-path' ||
                key === 'panel-display-mode' ||
                key === 'stealth-mode' ||
                key === 'speaking-glow-color'
            ) {
                if (key === 'speaking-glow-color') {
                    this._speakingGlowColor = s.get_string('speaking-glow-color') || '#23a55a';
                }
                if (key === 'taskbar-icon-size') {
                    const newSize = this._getTaskbarIconSize();
                    if (this._taskbarAvatar) {
                        this._taskbarAvatar.setSize(newSize);
                    }
                }
                this._updateUi();
            }
        });
    }

    _bindRpcEvents() {
        this._rpcUnsubscribers.push(
            this._rpc.on('connecting', () => {
                this._updateUi();
            })
        );

        this._rpcUnsubscribers.push(
            this._rpc.on('connected', () => {
                this._updateUi();
            })
        );

        this._rpcUnsubscribers.push(
            this._rpc.on('user-logged-out', () => {
                this._updateUi();
            })
        );

        this._rpcUnsubscribers.push(
            this._rpc.on('disconnected', (reason) => {
                this._updateUi(reason);
            })
        );

        this._rpcUnsubscribers.push(
            this._rpc.on('arrpc-detected', () => {
                this._updateUi();
            })
        );

        this._rpcUnsubscribers.push(
            this._rpc.on('auth-required', () => {
                this._updateUi();
            })
        );

        this._rpcUnsubscribers.push(
            this._rpc.on('authenticated', () => {
                this._updateUi();
            })
        );

        this._rpcUnsubscribers.push(
            this._rpc.on('voice-channel-changed', () => {
                this._updateUi();
            })
        );

        this._rpcUnsubscribers.push(
            this._rpc.on('voice-state-changed', () => {
                this._updateUi();
            })
        );

        this._rpcUnsubscribers.push(
            this._rpc.on('voice-settings-changed', settings => {
                this._syncVoiceSettings(settings);
            })
        );

        this._rpcUnsubscribers.push(
            this._rpc.on('speaking-changed', ({ userId, speaking }) => {
                this._onSpeakingChanged(userId, speaking);
            })
        );
    }

    _onSpeakingChanged(userId, speaking) {
        const glowColor = this._settings?.get_string('speaking-glow-color') || '#23a55a';
        const currentUserId = String(this._rpc.currentUser?.id || '');

        // Update top-bar avatar if current user is speaking
        if (currentUserId && String(userId) === currentUserId) {
            this._taskbarAvatar?.setSpeaking(speaking, glowColor);
        }

        // Update taskbar participant avatars
        if (this._participantWidgets) {
            for (const pWidget of this._participantWidgets) {
                if (pWidget._userId && String(pWidget._userId) === String(userId)) {
                    pWidget.setSpeaking(speaking, glowColor);
                }
            }
        }

        // Update popup menu widgets
        if (this._memberItemWidgets && this._memberItemWidgets.has(String(userId))) {
            const widgets = this._memberItemWidgets.get(String(userId));
            if (widgets?.avatar) {
                widgets.avatar.setSpeaking(speaking, glowColor);
            }
            if (widgets?.speakingBadge) {
                widgets.speakingBadge.visible = speaking;
            }
        }

        // In 'speaking-only' mode, active speech changes which avatars appear in top panel
        const displayMode = this._settings?.get_string('panel-display-mode') || 'avatars';
        if (displayMode === 'speaking-only') {
            this._updateTopBarVisuals();
        }
    }

    _syncVoiceSettings(settings) {
        if (!settings) return;

        const isMuted = Boolean(settings.mute);
        const isDeaf = Boolean(settings.deaf);

        if (isMuted) {
            this._muteBtn.add_style_class_name('is-active-red');
            this._muteIcon.icon_name = 'audio-input-microphone-muted-symbolic';
            this._muteText.text = _('Muted');
        } else {
            this._muteBtn.remove_style_class_name('is-active-red');
            this._muteIcon.icon_name = 'audio-input-microphone-symbolic';
            this._muteText.text = _('Mute');
        }

        if (isDeaf) {
            this._deafBtn.add_style_class_name('is-active-orange');
            this._deafIcon.icon_name = 'audio-volume-muted-symbolic';
            this._deafText.text = _('Deafened');
        } else {
            this._deafBtn.remove_style_class_name('is-active-orange');
            this._deafIcon.icon_name = 'audio-headset-symbolic';
            this._deafText.text = _('Deafen');
        }

        this._updateTopBarVisuals();
    }

    _updateUi(disconnectReason = null) {
        const isConnected = this._rpc.isConnected;
        const isConnecting = this._rpc.isConnecting;
        const isArRpc = this._rpc.isArRpc;
        const channel = this._rpc.currentVoiceChannel;
        const user = this._rpc.currentUser;
        const showDisconnected = this._settings?.get_boolean('show-disconnected-icon') ?? true;
        const stealthMode = this._settings?.get_boolean('stealth-mode') ?? false;

        // 1. Connecting State
        if (isConnecting) {
            if (stealthMode) {
                this.visible = false;
            } else {
                this.visible = true;
            }
            this._taskbarAvatar.setUser(user);
            this._taskbarAvatar.setDimmed(true);
            this._taskbarAvatar.setBorderColor('transparent');
            this._countLabel.text = '';

            this._headerAvatar.setUser(user);
            this._headerName.text = user?.global_name || user?.username || _('Connecting...');
            this._headerStatusDot.style_class = 'discord-status-dot is-connecting';
            this._headerStatusLabel.text = _('Connecting to Discord...');

            this._connectItem.visible = false;
            this._authItem.visible = false;
            this._authNoticeItem.visible = false;
            this._arRpcNoticeItem.visible = false;
            this._voiceCardItem.visible = false;
            this._channelSubMenu.visible = false;
            this._notInVoiceItem.visible = true;
            this._notInVoiceItem.label.text = _('Connecting to Discord socket...');
            this._populateMemberList([]);
            this._clearTaskbarParticipants();
            this._updateTopBarVisuals();
            this._refreshConnSubMenu();
            return;
        }

        // 2. Disconnected State
        if (!isConnected) {
            this._connectItem.visible = true;
            this._authItem.visible = false;
            this._authNoticeItem.visible = false;
            this._voiceCardItem.visible = false;
            this._channelSubMenu.visible = false;
            this._notInVoiceItem.visible = true;

            this._taskbarAvatar.setUser(user);
            this._taskbarAvatar.setBorderColor('transparent');
            this._taskbarAvatar.setDimmed(true);
            this._countLabel.text = '';

            this._headerAvatar.setUser(user);
            this._headerStatusDot.style_class = 'discord-status-dot is-disconnected';

            if (stealthMode) {
                this.visible = false;
            } else if (this._rpc.isLoggedOut) {
                this.visible = true;
                this._headerName.text = _('Sign-in Required');
                this._headerStatusLabel.text = _('Open & sign into Discord Desktop');
                this._notInVoiceItem.label.text = _('Socket open. Please sign in to Discord desktop.');
            } else {
                if (!showDisconnected) {
                    this.visible = false;
                } else {
                    this.visible = true;
                }
                this._headerName.text = _('Discord Disconnected');
                if (disconnectReason && typeof disconnectReason === 'string') {
                    this._headerStatusLabel.text = `${_('Disconnected')}: ${disconnectReason}`;
                } else {
                    this._headerStatusLabel.text = _('Discord is disconnected');
                }
                this._notInVoiceItem.label.text = _('Click "Connect to Discord" below to begin.');
            }

            this._arRpcNoticeItem.visible = false;
            this._populateMemberList([]);
            this._clearTaskbarParticipants();
            this._updateTopBarVisuals();
            this._refreshConnSubMenu();
            return;
        }

        // 3. Connected
        this._connectItem.visible = false;

        // Update user profile in header & taskbar
        this._headerAvatar.setUser(user);
        this._taskbarAvatar.setUser(user);
        this._taskbarAvatar.setDimmed(false);

        const displayName = user?.global_name || user?.username || _('Discord User');
        const handle = user?.username ? `@${user.username}` : '';
        this._headerName.text = handle ? `${displayName} (${handle})` : displayName;

        // Check arRPC stub
        if (isArRpc) {
            this._authItem.visible = false;
            this._authNoticeItem.visible = false;
            this._voiceCardItem.visible = false;
            this._channelSubMenu.visible = false;
            this._notInVoiceItem.visible = true;
            this._notInVoiceItem.label.text = _('Voice status unsupported on arRPC bridge.');
            this._arRpcNoticeItem.visible = true;
            this._headerStatusDot.style_class = 'discord-status-dot is-connecting';
            this._headerStatusLabel.text = _('arRPC (Rich Presence only)');
            this._taskbarAvatar.setBorderColor('transparent');
            this._populateMemberList([]);
            this._clearTaskbarParticipants();
            this._updateTopBarVisuals();
            this._refreshConnSubMenu();
            return;
        }

        this._arRpcNoticeItem.visible = false;

        // Check Authorization
        if (!this._rpc.isAuthenticated) {
            this._authItem.label.text = _('🔑 Authorize Voice Access (1-Click)');
            this._authItem.visible = true;
            this._authNoticeItem.visible = true;
            this._voiceCardItem.visible = false;
            this._channelSubMenu.visible = false;
            this._notInVoiceItem.visible = false;

            this._headerStatusDot.style_class = 'discord-status-dot is-connecting';
            this._headerStatusLabel.text = _('Authorization Required');
            this._taskbarAvatar.setBorderColor('transparent');

            this._populateAuthRequiredMessage();
            this._clearTaskbarParticipants();
            this._updateTopBarVisuals();
            this._refreshConnSubMenu();
            return;
        }

        // Authenticated!
        this._authItem.visible = false;
        this._authNoticeItem.visible = false;

        // In a voice channel vs Not in a voice channel
        if (!channel || !channel.id) {
            this._voiceCardItem.visible = false;
            this._channelSubMenu.visible = false;
            this._notInVoiceItem.visible = true;
            this._notInVoiceItem.label.text = _('Not in a voice channel');

            this._headerStatusDot.style_class = 'discord-status-dot is-connected';
            this._headerStatusLabel.text = _('Discord Connected');

            this._taskbarAvatar.setBorderColor('transparent');
            this._countLabel.text = '';
            this._populateMemberList([]);
            this._clearTaskbarParticipants();
            this._updateTopBarVisuals();
            this._refreshConnSubMenu();
            return;
        }

        // ACTIVE VOICE CHANNEL!
        this._notInVoiceItem.visible = false;
        this._voiceCardItem.visible = true;

        this._headerStatusDot.style_class = 'discord-status-dot is-connected';
        this._headerStatusLabel.text = _('Voice Active');

        const channelName = channel.name || _('Voice Channel');
        this._channelTitleLabel.text = `🔊 ${channelName}`;

        const members = channel.voice_states || [];
        try {
            this._populateMemberList(members);
        } catch (err) {
            console.error(`[DiscordVoice] Failed to populate member list: ${err.message}`, err);
        }

        try {
            this._syncVoiceSettings(this._rpc.currentVoiceSettings);
        } catch (err) {
            console.error(`[DiscordVoice] Failed to sync voice settings: ${err.message}`, err);
        }

        try {
            this._updateTopBarVisuals();
        } catch (err) {
            console.error(`[DiscordVoice] Failed to update top bar visuals: ${err.message}`, err);
        }

        try {
            this._refreshConnSubMenu();
        } catch (err) {
            console.error(`[DiscordVoice] Failed to refresh connection sub menu: ${err.message}`, err);
        }

        // Populate channel hopping submenu if in a guild
        if (channel.guild_id) {
            this._refreshChannelSubMenu(channel.guild_id, channel.id);
        } else {
            this._channelSubMenu.visible = false;
        }
    }

    async _refreshChannelSubMenu(guildId, currentChannelId) {
        if (!this._channelSubMenu || !guildId) return;
        this._channelSubMenu.visible = true;

        try {
            const channels = await this._rpc.getChannels(guildId);
            this._channelSubMenu.menu.removeAll();

            const voiceChannels = (channels || []).filter(c => c && (c.type === 2 || c.type === 13));
            if (voiceChannels.length === 0) {
                const emptyItem = new PopupMenu.PopupMenuItem(_('No other voice channels'), { reactive: false });
                this._channelSubMenu.menu.addMenuItem(emptyItem);
                return;
            }

            for (const ch of voiceChannels) {
                const isActive = (String(ch.id) === String(currentChannelId));
                const label = isActive ? `🔊 ${ch.name} (${_('Active')})` : `🔊 ${ch.name}`;
                const chItem = new PopupMenu.PopupMenuItem(label);

                if (isActive) {
                    chItem.setOrnament(PopupMenu.Ornament.DOT);
                } else {
                    chItem.connect('activate', () => {
                        this._rpc.selectVoiceChannel(ch.id).catch(e => {
                            console.warn(`[DiscordVoice] Failed to switch channel: ${e.message}`);
                        });
                    });
                }
                this._channelSubMenu.menu.addMenuItem(chItem);
            }
        } catch (e) {
            console.warn(`[DiscordVoice] Error refreshing channels: ${e.message}`);
        }
    }

    _clearTaskbarParticipants() {
        if (this._participantWidgetMap) {
            for (const w of this._participantWidgetMap.values()) {
                try {
                    w.destroy();
                } catch (_) {}
            }
            this._participantWidgetMap.clear();
        }
        if (this._participantWidgets) {
            for (const w of this._participantWidgets) {
                try {
                    w.destroy();
                } catch (_) {}
            }
        }
        this._participantWidgets = [];
        if (this._taskbarParticipantsBox) {
            try {
                const children = this._taskbarParticipantsBox.get_children();
                if (children) {
                    for (const c of children) {
                        try {
                            c.destroy();
                        } catch (_) {}
                    }
                }
            } catch (_) {}
            try {
                this._taskbarParticipantsBox.destroy_all_children();
            } catch (_) {}
        }
        if (this._taskbarOverflowLabel) {
            this._taskbarOverflowLabel.text = '';
            this._taskbarOverflowLabel.visible = false;
        }
    }

    _updateTopBarVisuals() {
        const isConnected = this._rpc.isConnected;
        const isArRpc = this._rpc.isArRpc;
        const isAuthenticated = this._rpc.isAuthenticated;
        const channel = this._rpc.currentVoiceChannel;
        const voiceSettings = this._rpc.currentVoiceSettings;
        const avatarOnly = this._settings?.get_boolean('taskbar-avatar-only') ?? true;
        const showCount = this._settings?.get_boolean('show-member-count') ?? true;
        const showParticipants = this._settings?.get_boolean('show-taskbar-participants') ?? true;
        const maxParticipants = Math.max(1, Math.min(10, this._settings?.get_int('taskbar-max-participants') || 3));
        const displayMode = this._settings?.get_string('panel-display-mode') || 'avatars';
        const stealthMode = this._settings?.get_boolean('stealth-mode') ?? false;
        const showDisconnected = this._settings?.get_boolean('show-disconnected-icon') ?? true;
        const iconSize = this._getTaskbarIconSize();

        if (this._taskbarAvatar) {
            this._taskbarAvatar.setSize(iconSize);
        }

        // Stealth Mode check
        if (stealthMode && (!channel || !channel.id || !isConnected || isArRpc || !isAuthenticated)) {
            this.visible = false;
        } else if (!isConnected && !showDisconnected && !stealthMode) {
            this.visible = false;
        } else {
            this.visible = true;
        }

        if (!isConnected || isArRpc || !isAuthenticated) {
            this._countLabel.text = '';
            if (this._pillBox) this._pillBox.visible = false;
            if (this._taskbarAvatar) {
                this._taskbarAvatar.visible = (displayMode !== 'pill');
                this._taskbarAvatar.setBorderColor('transparent');
                this._taskbarAvatar.setSpeaking(false);
            }
            if (this._taskbarParticipantsBox) this._taskbarParticipantsBox.visible = false;
            this._clearTaskbarParticipants();
            return;
        }

        if (channel && channel.id) {
            const members = channel.voice_states || [];
            const isMuted = Boolean(voiceSettings?.mute);
            const isDeaf = Boolean(voiceSettings?.deaf);
            const isCurrentUserSpeaking = this._rpc.isUserSpeaking(this._rpc.currentUser?.id);
            const glowColor = this._settings?.get_string('speaking-glow-color') || '#23a55a';

            // Check if Pill Mode
            if (displayMode === 'pill') {
                if (this._taskbarAvatar) this._taskbarAvatar.visible = false;
                if (this._taskbarParticipantsBox) this._taskbarParticipantsBox.visible = false;
                if (this._taskbarOverflowLabel) this._taskbarOverflowLabel.visible = false;
                if (this._countLabel) this._countLabel.visible = false;

                if (this._pillBox) {
                    this._pillBox.visible = true;
                    this._pillBox.remove_style_class_name('is-active');
                    this._pillBox.remove_style_class_name('is-muted');
                    this._pillBox.remove_style_class_name('is-deaf');

                    if (isDeaf) {
                        this._pillBox.add_style_class_name('is-deaf');
                        this._pillIcon.icon_name = 'audio-volume-muted-symbolic';
                    } else if (isMuted) {
                        this._pillBox.add_style_class_name('is-muted');
                        this._pillIcon.icon_name = 'audio-input-microphone-muted-symbolic';
                    } else {
                        this._pillBox.add_style_class_name('is-active');
                        this._pillIcon.icon_name = 'audio-headset-symbolic';
                    }

                    const chName = channel.name || _('Voice');
                    this._pillLabel.text = `${chName} • ${members.length}`;
                }
                return;
            }

            // Normal / Speaking-Only Avatars Mode
            if (this._pillBox) this._pillBox.visible = false;
            if (this._taskbarParticipantsBox) this._taskbarParticipantsBox.visible = true;
            if (this._taskbarAvatar) {
                this._taskbarAvatar.visible = true;
                if (isDeaf) {
                    this._taskbarAvatar.setBorderColor('#f0b232');
                } else if (isMuted) {
                    this._taskbarAvatar.setBorderColor('#f23f43');
                } else {
                    this._taskbarAvatar.setBorderColor('#23a55a');
                }
                this._taskbarAvatar.setSpeaking(isCurrentUserSpeaking, glowColor);
            }

            // Update participant avatar icons in taskbar
            if (!this._participantWidgetMap) {
                this._participantWidgetMap = new Map();
            }

            if (showParticipants && members.length > 0) {
                const currentUserId = String(this._rpc.currentUser?.id || '');
                let otherParticipants = members.filter(m => {
                    const uid = String(m?.user?.id || m?.user_id || m?.id || '');
                    return uid && (!currentUserId || uid !== currentUserId);
                });

                // If speaking-only mode, only show participants who are actively speaking
                if (displayMode === 'speaking-only') {
                    otherParticipants = otherParticipants.filter(m => {
                        const uid = String(m?.user?.id || m?.user_id || m?.id || '');
                        return uid && this._rpc.isUserSpeaking(uid);
                    });
                }

                const visibleParticipants = otherParticipants.slice(0, maxParticipants);
                const remaining = otherParticipants.length - visibleParticipants.length;

                const visibleUserIds = new Set();
                const newWidgetsList = [];

                for (const member of visibleParticipants) {
                    try {
                        const userObj = member.user || {
                            id: member.user_id || member.id,
                            username: member.nick || member.username || 'User',
                        };
                        const memberId = String(userObj.id || member.user_id || member.id || '');
                        if (!memberId) continue;
                        visibleUserIds.add(memberId);

                        const isMemMuted = Boolean(
                            member.voice_state?.mute ||
                            member.voice_state?.self_mute ||
                            member.mute ||
                            member.self_mute
                        );
                        const isMemDeaf = Boolean(
                            member.voice_state?.deaf ||
                            member.voice_state?.self_deaf ||
                            member.deaf ||
                            member.self_deaf
                        );
                        const isMemSpeaking = this._rpc.isUserSpeaking(memberId);
                        const targetBorderColor = isMemDeaf ? '#f0b232' : (isMemMuted ? '#f23f43' : '#23a55a');

                        let pAvatar = this._participantWidgetMap.get(memberId);
                        if (!pAvatar || pAvatar._destroyed) {
                            pAvatar = new AvatarWidget(this._avatarManager, iconSize, {
                                style_class: 'discord-panel-participant-avatar',
                                borderColor: targetBorderColor,
                                glowColor,
                            });
                            pAvatar._userId = memberId;
                            pAvatar.setUser(userObj);
                            this._participantWidgetMap.set(memberId, pAvatar);
                            this._taskbarParticipantsBox.add_child(pAvatar);
                        } else {
                            pAvatar.setSize(iconSize);
                            pAvatar.setBorderColor(targetBorderColor);
                            pAvatar.setUser(userObj);
                        }

                        pAvatar.setSpeaking(isMemSpeaking, glowColor);
                        newWidgetsList.push(pAvatar);
                    } catch (err) {
                        console.error(`[DiscordVoice] Error rendering taskbar participant: ${err.message}`);
                    }
                }

                // Destroy and remove widgets that are no longer visible
                for (const [uid, widget] of this._participantWidgetMap.entries()) {
                    if (!visibleUserIds.has(uid)) {
                        try {
                            if (widget.get_parent() === this._taskbarParticipantsBox) {
                                this._taskbarParticipantsBox.remove_child(widget);
                            }
                            widget.destroy();
                        } catch (_) {}
                        this._participantWidgetMap.delete(uid);
                    }
                }

                // Ensure child order in _taskbarParticipantsBox matches newWidgetsList
                for (let i = 0; i < newWidgetsList.length; i++) {
                    const w = newWidgetsList[i];
                    try {
                        if (typeof this._taskbarParticipantsBox.set_child_at_index === 'function') {
                            this._taskbarParticipantsBox.set_child_at_index(w, i);
                        }
                    } catch (_) {}
                }

                this._participantWidgets = newWidgetsList;

                if (remaining > 0 && this._taskbarOverflowLabel) {
                    this._taskbarOverflowLabel.text = `+${remaining}`;
                    this._taskbarOverflowLabel.visible = true;
                } else if (this._taskbarOverflowLabel) {
                    this._taskbarOverflowLabel.text = '';
                    this._taskbarOverflowLabel.visible = false;
                }
            } else {
                this._clearTaskbarParticipants();
            }

            if (!avatarOnly && showCount && members.length > 0) {
                this._countLabel.text = ` ${members.length}`;
            } else {
                this._countLabel.text = '';
            }
        } else {
            if (this._taskbarAvatar) {
                this._taskbarAvatar.setBorderColor('transparent');
                this._taskbarAvatar.setSpeaking(false);
            }
            if (this._pillBox) this._pillBox.visible = false;
            if (this._taskbarParticipantsBox) this._taskbarParticipantsBox.visible = false;
            this._countLabel.text = '';
            this._clearTaskbarParticipants();
        }
    }

    _refreshConnSubMenu() {
        if (!this._connSubMenu) return;
        this._connSubMenu.menu.removeAll();

        const isConnected = this._rpc.isConnected;
        const targetPath = this._rpc.manualSocketPath;

        if (isConnected) {
            const discItem = new PopupMenu.PopupMenuItem(_('🔌 Disconnect from Discord'));
            discItem.connect('activate', () => {
                this._rpc.disconnect('User requested disconnection');
            });
            this._connSubMenu.menu.addMenuItem(discItem);

            const recItem = new PopupMenu.PopupMenuItem(_('🔄 Reconnect Now'));
            recItem.connect('activate', () => {
                this._rpc.reconnect();
            });
            this._connSubMenu.menu.addMenuItem(recItem);
        } else {
            const connItem = new PopupMenu.PopupMenuItem(_('🔌 Connect to Discord'));
            connItem.connect('activate', () => {
                this._rpc.connect();
            });
            this._connSubMenu.menu.addMenuItem(connItem);
        }

        this._connSubMenu.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const pathInfoItem = new PopupMenu.PopupMenuItem(`${_('Target Socket:')} ${targetPath}`, {
            reactive: false,
            style_class: 'discord-socket-label',
        });
        pathInfoItem.label.clutter_text.set_line_wrap(true);
        this._connSubMenu.menu.addMenuItem(pathInfoItem);

        const changePathItem = new PopupMenu.PopupMenuItem(_('⚙️ Change Socket in Settings...'));
        changePathItem.connect('activate', () => {
            this.menu.close();
            this._extension.openPreferences();
        });
        this._connSubMenu.menu.addMenuItem(changePathItem);

        // Submenu label
        if (isConnected) {
            this._connSubMenu.label.text = `${_('Connection')}: ${_('Connected')}`;
        } else if (this._rpc.isConnecting) {
            this._connSubMenu.label.text = `${_('Connection')}: ${_('Connecting...')}`;
        } else {
            this._connSubMenu.label.text = `${_('Connection')}: ${_('Disconnected')}`;
        }
    }

    /**
     * Populate the voice participants list with circular profile picture avatars,
     * speaking glow indicators, and per-participant volume sliders and mute.
     */
    _populateMemberList(members) {
        this._memberSection.removeAll();
        this._memberItemWidgets = new Map();

        if (!members || members.length === 0) {
            return;
        }

        // Section Title: "VOICE PARTICIPANTS (X)"
        const headerItem = new PopupMenu.PopupMenuItem(
            `${_('VOICE PARTICIPANTS')} — ${members.length}`,
            { reactive: false, style_class: 'discord-members-title' }
        );
        this._memberSection.addMenuItem(headerItem);

        const currentUserId = String(this._rpc.currentUser?.id || '');
        const glowColor = this._settings?.get_string('speaking-glow-color') || '#23a55a';

        for (const member of members) {
            if (!member) continue;

            try {
                const userObj = member.user || {
                    id: member.user_id || member.id,
                    username: member.nick || member.username || 'User',
                };
                const userId = String(userObj.id || member.user_id || member.id || '');
                const isCurrentUser = Boolean(userId && currentUserId && userId === currentUserId);

                const memberItem = new PopupMenu.PopupBaseMenuItem({
                    reactive: true,
                    can_focus: true,
                    style_class: 'discord-member-item',
                });

                const rowBox = new St.BoxLayout({
                    x_expand: true,
                    y_align: Clutter.ActorAlign.CENTER,
                    style_class: 'discord-member-row',
                });

                // Participant Profile Picture Avatar (30px)
                const isMuted = Boolean(
                    member.voice_state?.mute ||
                    member.voice_state?.self_mute ||
                    member.mute ||
                    member.self_mute
                );
                const isDeaf = Boolean(
                    member.voice_state?.deaf ||
                    member.voice_state?.self_deaf ||
                    member.deaf ||
                    member.self_deaf
                );

                const isSpeaking = this._rpc.isUserSpeaking(userId);

                const memberAvatar = new AvatarWidget(this._avatarManager, 30, {
                    style_class: 'discord-member-avatar-widget',
                    borderColor: isDeaf ? '#f0b232' : (isMuted ? '#f23f43' : '#23a55a'),
                    glowColor,
                });
                memberAvatar.setUser(userObj);
                if (isSpeaking) {
                    memberAvatar.setSpeaking(true, glowColor);
                }
                rowBox.add_child(memberAvatar);

                // Participant Names (Display Name + Handle)
                const nameColumn = new St.BoxLayout({
                    orientation: Clutter.Orientation.VERTICAL,
                    x_expand: true,
                    y_align: Clutter.ActorAlign.CENTER,
                    style_class: 'discord-member-text-column',
                });

                const nameRow = new St.BoxLayout({
                    y_align: Clutter.ActorAlign.CENTER,
                });

                const displayName = member.nick || userObj.global_name || userObj.username || _('Unknown');
                const nameLabel = new St.Label({
                    text: displayName,
                    style_class: 'discord-member-name',
                });
                nameRow.add_child(nameLabel);

                // Bot Badge
                if (userObj.bot) {
                    const botBadge = new St.Label({
                        text: _('BOT'),
                        style_class: 'discord-bot-badge',
                    });
                    nameRow.add_child(botBadge);
                }

                // Real-time Speaking Badge
                const speakingBadge = new St.Label({
                    text: `🔊 ${_('Speaking')}`,
                    style_class: 'discord-speaking-badge',
                    visible: isSpeaking,
                });
                nameRow.add_child(speakingBadge);

                nameColumn.add_child(nameRow);

                if (userObj.username && userObj.username !== displayName) {
                    const handleLabel = new St.Label({
                        text: `@${userObj.username}`,
                        style_class: 'discord-member-handle',
                    });
                    nameColumn.add_child(handleLabel);
                }

                rowBox.add_child(nameColumn);

                // Audio State Badges on Right
                if (isMuted) {
                    const muteIcon = new St.Icon({
                        icon_name: 'audio-input-microphone-muted-symbolic',
                        style_class: 'discord-member-badge is-muted',
                        icon_size: 15,
                    });
                    rowBox.add_child(muteIcon);
                }

                if (isDeaf) {
                    const deafIcon = new St.Icon({
                        icon_name: 'audio-volume-muted-symbolic',
                        style_class: 'discord-member-badge is-deaf',
                        icon_size: 15,
                    });
                    rowBox.add_child(deafIcon);
                }

                // Expand Volume Slider Button (for other participants)
                let expandBtn = null;
                if (!isCurrentUser && userId) {
                    expandBtn = new St.Button({
                        style_class: 'discord-member-expand-btn',
                        can_focus: true,
                        label: this._expandedUsers.has(userId) ? '▴' : '▾',
                    });
                    rowBox.add_child(expandBtn);
                }

                memberItem.add_child(rowBox);
                this._memberSection.addMenuItem(memberItem);

                if (userId) {
                    this._memberItemWidgets.set(userId, {
                        avatar: memberAvatar,
                        speakingBadge,
                    });
                }

                // Expandable Per-Participant Volume & Mute Controls
                if (!isCurrentUser && userId) {
                    const isExpanded = this._expandedUsers.has(userId);
                    const controlsContainer = new St.BoxLayout({
                        orientation: Clutter.Orientation.VERTICAL,
                        style_class: 'discord-member-controls-container',
                        visible: isExpanded,
                    });

                    const controlsRow = new St.BoxLayout({
                        style_class: 'discord-member-controls-row',
                        y_align: Clutter.ActorAlign.CENTER,
                        x_expand: true,
                    });

                    const volIcon = new St.Icon({
                        icon_name: 'audio-volume-high-symbolic',
                        icon_size: 14,
                    });
                    controlsRow.add_child(volIcon);

                    let currentVolume = this._userVolumeSettings.get(userId)?.volume ?? (typeof member.volume === 'number' ? member.volume : 100);
                    let isUserMuted = this._userVolumeSettings.get(userId)?.mute ?? Boolean(member.mute);

                    // Slider (0.0 to 1.0 represents 0% to 200%)
                    const sliderVal = Math.min(1.0, Math.max(0.0, currentVolume / 200.0));
                    let slider = null;
                    try {
                        slider = new Slider.Slider(sliderVal);
                    } catch (_) {
                        try {
                            slider = new Slider.Slider({ value: sliderVal });
                        } catch (e) {
                            console.warn(`[DiscordVoice] Could not instantiate Slider: ${e.message}`);
                        }
                    }

                    const volLabel = new St.Label({
                        text: `${currentVolume}%`,
                        style_class: 'discord-volume-label',
                        y_align: Clutter.ActorAlign.CENTER,
                    });

                    if (slider) {
                        slider.x_expand = true;
                        slider.style_class = 'discord-volume-slider';
                        controlsRow.add_child(slider);
                    }

                    controlsRow.add_child(volLabel);

                    const resetBtn = new St.Button({
                        style_class: 'discord-volume-btn',
                        label: '100%',
                        can_focus: true,
                    });
                    controlsRow.add_child(resetBtn);

                    const userMuteBtn = new St.Button({
                        style_class: isUserMuted
                            ? 'discord-member-mute-toggle is-muted'
                            : 'discord-member-mute-toggle',
                        label: isUserMuted ? _('Unmute') : _('Mute'),
                        can_focus: true,
                    });
                    controlsRow.add_child(userMuteBtn);

                    controlsContainer.add_child(controlsRow);

                    const controlsItem = new PopupMenu.PopupBaseMenuItem({
                        reactive: true,
                        activate: false,
                        style_class: 'discord-popup-card-item',
                    });
                    controlsItem.add_child(controlsContainer);
                    this._memberSection.addMenuItem(controlsItem);
                    controlsItem.visible = isExpanded;

                    if (expandBtn) {
                        expandBtn.connect('clicked', () => {
                            const isExp = !this._expandedUsers.has(userId);
                            if (isExp) {
                                this._expandedUsers.add(userId);
                                expandBtn.label = '▴';
                                controlsContainer.visible = true;
                                controlsItem.visible = true;
                            } else {
                                this._expandedUsers.delete(userId);
                                expandBtn.label = '▾';
                                controlsContainer.visible = false;
                                controlsItem.visible = false;
                            }
                        });
                    }

                    if (slider) {
                        slider.connect('notify::value', () => {
                            const volPercent = Math.round(slider.value * 200);
                            volLabel.text = `${volPercent}%`;
                            this._userVolumeSettings.set(userId, {
                                volume: volPercent,
                                mute: isUserMuted,
                            });
                            this._rpc.setUserVoiceSettings(userId, { volume: volPercent }).catch(e => {
                                console.warn(`[DiscordVoice] Failed to set user volume: ${e.message}`);
                            });
                        });
                    }

                    resetBtn.connect('clicked', () => {
                        if (slider) {
                            slider.value = 0.5; // 100%
                        }
                        volLabel.text = '100%';
                        this._userVolumeSettings.set(userId, {
                            volume: 100,
                            mute: isUserMuted,
                        });
                        this._rpc.setUserVoiceSettings(userId, { volume: 100 }).catch(e => {
                            console.warn(`[DiscordVoice] Failed to reset user volume: ${e.message}`);
                        });
                    });

                    userMuteBtn.connect('clicked', () => {
                        isUserMuted = !isUserMuted;
                        const volVal = slider ? Math.round(slider.value * 200) : currentVolume;
                        this._userVolumeSettings.set(userId, {
                            volume: volVal,
                            mute: isUserMuted,
                        });
                        if (isUserMuted) {
                            userMuteBtn.add_style_class_name('is-muted');
                            userMuteBtn.label = _('Unmute');
                        } else {
                            userMuteBtn.remove_style_class_name('is-muted');
                            userMuteBtn.label = _('Mute');
                        }
                        this._rpc.setUserVoiceSettings(userId, { mute: isUserMuted }).catch(e => {
                            console.warn(`[DiscordVoice] Failed to toggle user mute: ${e.message}`);
                        });
                    });
                }
            } catch (err) {
                console.error(`[DiscordVoice] Error rendering member item: ${err.message}`, err);
            }
        }
    }

    _populateAuthRequiredMessage() {
        this._memberSection.removeAll();
        const msgItem = new PopupMenu.PopupMenuItem(
            _('Click "Authorize Voice Access" above to grant permissions to view voice participants and control audio.'),
            { reactive: false, style_class: 'discord-empty-members-label' }
        );
        msgItem.label.clutter_text.set_line_wrap(true);
        this._memberSection.addMenuItem(msgItem);
    }

    destroy() {
        if (this._menuOpenId) {
            this.menu.disconnect(this._menuOpenId);
            this._menuOpenId = null;
        }

        for (const unsubscribe of this._rpcUnsubscribers) {
            try {
                unsubscribe();
            } catch (_) {}
        }
        this._rpcUnsubscribers = [];

        if (this._settings && this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }

        if (this._connectItem && this._connectItemId) {
            this._connectItem.disconnect(this._connectItemId);
            this._connectItemId = null;
        }

        if (this._authItem && this._authItemId) {
            this._authItem.disconnect(this._authItemId);
            this._authItemId = null;
        }

        this._clearTaskbarParticipants();

        if (this._taskbarParticipantsBox) {
            this._taskbarParticipantsBox.destroy();
            this._taskbarParticipantsBox = null;
        }

        if (this._taskbarOverflowLabel) {
            this._taskbarOverflowLabel.destroy();
            this._taskbarOverflowLabel = null;
        }

        if (this._taskbarAvatar) {
            this._taskbarAvatar.destroy();
            this._taskbarAvatar = null;
        }

        if (this._headerAvatar) {
            this._headerAvatar.destroy();
            this._headerAvatar = null;
        }

        if (this._pillBox) {
            this._pillBox.destroy();
            this._pillBox = null;
        }

        this._memberItemWidgets.clear();
        this._userVolumeSettings.clear();
        this._expandedUsers.clear();

        super.destroy();
    }
});
