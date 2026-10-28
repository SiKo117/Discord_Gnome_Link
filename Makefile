UUID = discord-voice-panel@example.com
EXT_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
ZIP_FILE = $(UUID).shell-extension.zip

FILES = metadata.json \
        extension.js \
        indicator.js \
        discordRpc.js \
        rpcProtocol.js \
        socketUtils.js \
        avatarUtils.js \
        avatarManager.js \
        prefs.js \
        stylesheet.css \
        schemas/org.gnome.shell.extensions.discord-voice-panel.gschema.xml \
        schemas/gschemas.compiled

.PHONY: all build pack install link update uninstall purge enable disable test clean

all: build

build: schemas/gschemas.compiled

schemas/gschemas.compiled: schemas/org.gnome.shell.extensions.discord-voice-panel.gschema.xml
	glib-compile-schemas schemas/

pack: build
	@echo "Packaging extension into $(ZIP_FILE)..."
	rm -f $(ZIP_FILE)
	@if command -v gnome-extensions > /dev/null 2>&1; then \
		gnome-extensions pack --force \
			--extra-source=indicator.js \
			--extra-source=discordRpc.js \
			--extra-source=rpcProtocol.js \
			--extra-source=socketUtils.js \
			--extra-source=avatarUtils.js \
			--extra-source=avatarManager.js \
			--extra-source=stylesheet.css .; \
	else \
		python3 -c "import zipfile, sys; zf = zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED); [zf.write(f, f) for f in sys.argv[2:]]; zf.close()" $(ZIP_FILE) $(FILES); \
	fi
	@echo "Package created: $(ZIP_FILE)"

install: build
	@echo "Installing extension to $(EXT_DIR)..."
	mkdir -p $(EXT_DIR)/schemas
	cp metadata.json extension.js indicator.js discordRpc.js rpcProtocol.js socketUtils.js avatarUtils.js avatarManager.js prefs.js stylesheet.css $(EXT_DIR)/
	cp schemas/org.gnome.shell.extensions.discord-voice-panel.gschema.xml $(EXT_DIR)/schemas/
	glib-compile-schemas $(EXT_DIR)/schemas/
	@echo "Installation complete. Enable with: make enable"

link: build
	@echo "Symlinking extension to $(EXT_DIR)..."
	mkdir -p $(dir $(EXT_DIR))
	ln -sfn $(CURDIR) $(EXT_DIR)
	@echo "Symlink created. Enable with: make enable"

update:
	@chmod +x update.sh
	./update.sh

uninstall:
	@chmod +x uninstall.sh
	./uninstall.sh

purge:
	@chmod +x uninstall.sh
	./uninstall.sh --purge

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

test:
	node tests/test_rpcProtocol.mjs
	node tests/test_socketUtils.mjs
	node tests/test_authFlow.mjs
	node tests/test_avatarManager.mjs
	node tests/test_participantLifecycle.mjs
	node tests/test_newFeatures.mjs
	node tests/test_auditFixes.mjs

clean:
	rm -f $(ZIP_FILE) schemas/gschemas.compiled
