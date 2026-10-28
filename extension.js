import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { DiscordVoiceIndicator } from './indicator.js';
import { DiscordRpcClient } from './discordRpc.js';

export default class DiscordVoicePanelExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        // Initialize RPC client
        this._rpcClient = new DiscordRpcClient(this._settings);

        // Initialize UI indicator
        this._indicator = new DiscordVoiceIndicator(this, this._rpcClient);
        
        // Add indicator to panel at customized position and index
        this._addToPanel();

        // Listen for panel position settings changes
        this._settingsChangedId = this._settings.connect('changed', (s, key) => {
            if (key === 'panel-position' || key === 'panel-index') {
                this._repositionIndicator();
            }
        });

        // Connect to Discord IPC
        this._rpcClient.start();

        // Monitor session mode (e.g., refresh voice status upon screen unlock)
        this._sessionModeId = Main.sessionMode.connect('updated', () => {
            if (!Main.sessionMode.isLocked && this._rpcClient?.isConnected) {
                this._rpcClient.getSelectedVoiceChannel().catch(() => {});
                this._rpcClient.getVoiceSettings().catch(() => {});
            }
        });
    }

    _addToPanel() {
        const settings = this._settings || this.getSettings();
        const position = settings.get_string('panel-position') || 'right';
        const index = settings.get_int('panel-index') ?? 0;
        Main.panel.addToStatusArea(this.uuid, this._indicator, index, position);
    }

    _repositionIndicator() {
        if (!this._indicator) return;
        const settings = this._settings || this.getSettings();
        const position = settings.get_string('panel-position') || 'right';
        const index = settings.get_int('panel-index') ?? 0;

        const actor = this._indicator.container || this._indicator;
        const parent = actor.get_parent();
        if (parent) {
            parent.remove_child(actor);
        }

        let targetBox;
        if (position === 'left') {
            targetBox = Main.panel._leftBox;
        } else if (position === 'center') {
            targetBox = Main.panel._centerBox;
        } else {
            targetBox = Main.panel._rightBox;
        }

        if (targetBox) {
            const count = targetBox.get_n_children();
            const safeIndex = Math.max(0, Math.min(index, count));
            targetBox.insert_child_at_index(actor, safeIndex);
        }
    }

    disable() {
        if (this._settings && this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        this._settings = null;

        if (this._sessionModeId) {
            Main.sessionMode.disconnect(this._sessionModeId);
            this._sessionModeId = null;
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        if (this._rpcClient) {
            this._rpcClient.destroy();
            this._rpcClient = null;
        }
    }
}
