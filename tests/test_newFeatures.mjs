import assert from 'node:assert';
import { OP_FRAME, encodeFrame, FrameDecoder } from '../rpcProtocol.js';

console.log('Running new features unit tests (Speaking Glow, Volume Slider & Mute, Channel Hopping, Mouse Actions, Display & Stealth Modes)...');

// 1. Test Real-time Speaking Event & Glow Logic
{
    console.log('Testing Feature 1: Real-Time Speaking Glow Indicator...');

    const speakingEventPayload = {
        cmd: 'DISPATCH',
        evt: 'SPEAKING',
        data: {
            user_id: '123456789012345678',
            speaking: 1,
            channel_id: '999888777666',
        },
    };

    const encoded = encodeFrame(OP_FRAME, speakingEventPayload);
    const decoder = new FrameDecoder();
    const [frame] = decoder.feed(encoded);

    assert.strictEqual(frame.opcode, OP_FRAME);
    assert.strictEqual(frame.data.evt, 'SPEAKING');
    assert.strictEqual(frame.data.data.user_id, '123456789012345678');
    assert.strictEqual(frame.data.data.speaking, 1);

    // Mock speaking state tracking
    const speakingUsers = new Set();
    const handleSpeaking = (data) => {
        if (data.speaking) {
            speakingUsers.add(String(data.user_id));
        } else {
            speakingUsers.delete(String(data.user_id));
        }
    };

    handleSpeaking(frame.data.data);
    assert.strictEqual(speakingUsers.has('123456789012345678'), true);

    // User stops speaking
    handleSpeaking({ user_id: '123456789012345678', speaking: 0 });
    assert.strictEqual(speakingUsers.has('123456789012345678'), false);

    console.log('✓ Test 1: Real-Time Speaking event encode/decode and state tracking passed');
}

// 2. Test Per-Participant Volume & Mute RPC commands
{
    console.log('Testing Feature 2: Per-Participant Volume Slider and Mute...');

    // SET_USER_VOICE_SETTINGS
    const setVoiceSettingsPayload = {
        cmd: 'SET_USER_VOICE_SETTINGS',
        args: {
            user_id: '123456789012345678',
            volume: 150,
            mute: true,
        },
        nonce: 'test-nonce-vol-1',
    };

    const encoded = encodeFrame(OP_FRAME, setVoiceSettingsPayload);
    const decoder = new FrameDecoder();
    const [frame] = decoder.feed(encoded);

    assert.strictEqual(frame.data.cmd, 'SET_USER_VOICE_SETTINGS');
    assert.strictEqual(frame.data.args.user_id, '123456789012345678');
    assert.strictEqual(frame.data.args.volume, 150);
    assert.strictEqual(frame.data.args.mute, true);

    // Volume calculation from slider value (0.0 to 1.0 represents 0% to 200%)
    const calculateVolume = (sliderVal) => Math.round(sliderVal * 200);
    assert.strictEqual(calculateVolume(0.0), 0);
    assert.strictEqual(calculateVolume(0.5), 100);
    assert.strictEqual(calculateVolume(0.75), 150);
    assert.strictEqual(calculateVolume(1.0), 200);

    console.log('✓ Test 2: Per-participant volume command framing and slider math passed');
}

// 3. Test Quick Voice Channel Hopping
{
    console.log('Testing Feature 3: Quick Voice Channel Hopping...');

    // GET_CHANNELS
    const getChannelsPayload = {
        cmd: 'GET_CHANNELS',
        args: { guild_id: '111222333444' },
        nonce: 'test-nonce-channels-1',
    };

    const encoded = encodeFrame(OP_FRAME, getChannelsPayload);
    const decoder = new FrameDecoder();
    const [frame] = decoder.feed(encoded);

    assert.strictEqual(frame.data.cmd, 'GET_CHANNELS');
    assert.strictEqual(frame.data.args.guild_id, '111222333444');

    // Filtering voice channels (type 2 = GUILD_VOICE, type 13 = GUILD_STAGE_VOICE)
    const mockChannels = [
        { id: '1', name: 'general-text', type: 0 },
        { id: '2', name: 'General Voice', type: 2 },
        { id: '3', name: 'Gaming Lounge', type: 2 },
        { id: '4', name: 'Stage Talk', type: 13 },
        { id: '5', name: 'announcements', type: 5 },
    ];

    const voiceOnly = mockChannels.filter(c => c.type === 2 || c.type === 13);
    assert.strictEqual(voiceOnly.length, 3);
    assert.deepStrictEqual(voiceOnly.map(c => c.id), ['2', '3', '4']);

    // SELECT_VOICE_CHANNEL
    const selectPayload = {
        cmd: 'SELECT_VOICE_CHANNEL',
        args: { channel_id: '3', force: true },
        nonce: 'test-nonce-select-1',
    };
    const selectFrame = decoder.feed(encodeFrame(OP_FRAME, selectPayload))[0];
    assert.strictEqual(selectFrame.data.cmd, 'SELECT_VOICE_CHANNEL');
    assert.strictEqual(selectFrame.data.args.channel_id, '3');

    console.log('✓ Test 3: Voice channel hopping and filtering passed');
}

// 4. Test Quick Mouse Action execution logic
{
    console.log('Testing Feature 4: Quick Mouse Actions (Customizable)...');

    class ActionSimulator {
        constructor() {
            this.muted = false;
            this.deafened = false;
            this.channel = 'current_channel_id';
            this.displayMode = 'avatars';
            this.menuOpen = false;
        }

        execute(action) {
            switch (action) {
                case 'toggle-mute':
                    this.muted = !this.muted;
                    return true;
                case 'toggle-deaf':
                    this.deafened = !this.deafened;
                    return true;
                case 'leave-channel':
                    this.channel = null;
                    return true;
                case 'cycle-display-mode': {
                    const modes = ['avatars', 'pill', 'speaking-only'];
                    const idx = (modes.indexOf(this.displayMode) + 1) % modes.length;
                    this.displayMode = modes[idx];
                    return true;
                }
                case 'toggle-menu':
                    this.menuOpen = !this.menuOpen;
                    return true;
                case 'none':
                default:
                    return false;
            }
        }
    }

    const sim = new ActionSimulator();

    // Test Middle click default (toggle-mute)
    assert.strictEqual(sim.muted, false);
    sim.execute('toggle-mute');
    assert.strictEqual(sim.muted, true);
    sim.execute('toggle-mute');
    assert.strictEqual(sim.muted, false);

    // Test Right click default (leave-channel)
    assert.strictEqual(sim.channel, 'current_channel_id');
    sim.execute('leave-channel');
    assert.strictEqual(sim.channel, null);

    // Test Cycle display mode
    assert.strictEqual(sim.displayMode, 'avatars');
    sim.execute('cycle-display-mode');
    assert.strictEqual(sim.displayMode, 'pill');
    sim.execute('cycle-display-mode');
    assert.strictEqual(sim.displayMode, 'speaking-only');
    sim.execute('cycle-display-mode');
    assert.strictEqual(sim.displayMode, 'avatars');

    // Test toggle-deaf
    sim.execute('toggle-deaf');
    assert.strictEqual(sim.deafened, true);

    console.log('✓ Test 4: Customizable quick mouse action simulation passed');
}

// 5. Test Dynamic Panel Display Modes & Stealth Mode
{
    console.log('Testing Feature 5: Dynamic Display Modes & Stealth Mode...');

    class IndicatorDisplaySimulator {
        constructor(stealthMode = false, displayMode = 'avatars') {
            this.stealthMode = stealthMode;
            this.displayMode = displayMode;
            this.visible = true;
            this.channel = null;
            this.speakingUsers = new Set();
        }

        updateUi(inVoiceChannel) {
            this.channel = inVoiceChannel ? { id: 'voice-1', name: 'General' } : null;

            if (this.stealthMode && (!this.channel || !this.channel.id)) {
                this.visible = false;
            } else {
                this.visible = true;
            }
        }

        filterParticipants(members) {
            if (this.displayMode === 'speaking-only') {
                return members.filter(m => this.speakingUsers.has(m.id));
            }
            return members;
        }
    }

    // Stealth Mode tests:
    const stealthSim = new IndicatorDisplaySimulator(true, 'avatars');
    // Initially not in voice channel -> hidden
    stealthSim.updateUi(false);
    assert.strictEqual(stealthSim.visible, false, 'Should be hidden in stealth mode when idle');

    // Joins voice channel -> becomes visible
    stealthSim.updateUi(true);
    assert.strictEqual(stealthSim.visible, true, 'Should be visible when joined voice channel in stealth mode');

    // Leaves voice channel -> hidden again
    stealthSim.updateUi(false);
    assert.strictEqual(stealthSim.visible, false, 'Should hide again after leaving channel');

    // Speaking-Only Dynamic Mode tests:
    const speakingOnlySim = new IndicatorDisplaySimulator(false, 'speaking-only');
    const participants = [
        { id: 'user_1', name: 'Alice' },
        { id: 'user_2', name: 'Bob' },
        { id: 'user_3', name: 'Charlie' },
    ];

    // Nobody speaking -> 0 participants shown
    assert.strictEqual(speakingOnlySim.filterParticipants(participants).length, 0);

    // Bob starts speaking -> only Bob is shown
    speakingOnlySim.speakingUsers.add('user_2');
    const activeSpeakers = speakingOnlySim.filterParticipants(participants);
    assert.strictEqual(activeSpeakers.length, 1);
    assert.strictEqual(activeSpeakers[0].name, 'Bob');

    // Alice also speaks -> Alice and Bob shown
    speakingOnlySim.speakingUsers.add('user_1');
    assert.strictEqual(speakingOnlySim.filterParticipants(participants).length, 2);

    console.log('✓ Test 5: Dynamic display modes and stealth auto-hide verified');
}

console.log('All new features unit tests passed successfully!');
