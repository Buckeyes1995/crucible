# Forge Menu Bar Companion

macOS menu bar app that shows the active Forge model and lets you quick-switch.

## Setup

```bash
cd menubar
/opt/homebrew/bin/python3.13 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python forge_menubar.py
```

## Features

- Menu bar title shows active model name + memory pressure
- Spinner (⟳) during loading
- Click any model to load it
- Stop model button
- Opens Web UI in browser

## Auto-start on login

```bash
# Create a launchd plist
cat > ~/Library/LaunchAgents/com.jim.forge-menubar.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.jim.forge-menubar</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/jim/projects/forge/menubar/.venv/bin/python</string>
        <string>/Users/jim/projects/forge/menubar/forge_menubar.py</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.jim.forge-menubar.plist
```
