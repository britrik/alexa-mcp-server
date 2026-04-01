#!/usr/bin/env python3
"""
LG SH7 Soundbar API Server - Fixed Implementation
Based on goodspeaker Go library research
"""

import json
import socket
import struct
import tempfile
import os
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime

# Install crypto dependencies first
try:
    from Crypto.Cipher import AES
    from Crypto.Util.Padding import pad, unpad
except ImportError:
    import subprocess
    subprocess.run(["pip3", "install", "pycryptodome"], check=True)
    from Crypto.Cipher import AES
    from Crypto.Util.Padding import pad, unpad

# Load configuration from environment or .env file
def load_config():
    """Load configuration from environment variables"""
    # Default values
    config = {
        "HOST": os.environ.get("SOUNDBAR_HOST", "192.168.1.150"),
        "PORT": int(os.environ.get("SOUNDBAR_PORT", "9741")),
        "LISTEN_ADDR": os.environ.get("API_LISTEN_ADDR", "127.0.0.1"),
        "LISTEN_PORT": int(os.environ.get("API_LISTEN_PORT", "8765")),
        "MUFLACTL": os.environ.get("MUFLACTL_PATH", "/usr/local/bin/mufloctl"),
        "DEVICE_TYPE": os.environ.get("DEVICE_TYPE", "musicflow"),
    }
    
    # Try to load from .env file
    env_file = os.path.join(os.path.dirname(__file__), "soundbar-api.env")
    if os.path.exists(env_file):
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    config[key.strip()] = value.strip()
    
    return config

CONFIG = load_config()

# Aliases for backward compatibility
HOST = CONFIG["HOST"]
PORT = CONFIG["PORT"]
LISTEN_ADDR = CONFIG["LISTEN_ADDR"]
LISTEN_PORT = CONFIG["LISTEN_PORT"]
MUFLACTL = CONFIG["MUFLACTL"]
DEVICE_TYPE = CONFIG["DEVICE_TYPE"]

# Protocol keys (from goodspeaker library - these are public protocol constants)
if DEVICE_TYPE == "musicflow":
    PROTO_KEY = b"4efgvbn m546Uy7kolKrftgbn =-0u&~"
    PROTO_IV = b"54eRty@hkL,;/y9U"
else:
    PROTO_KEY = b"T^&*J%^7tr~4^%^&I(o%^!jIJ__+a0 k"
    PROTO_IV = b"'%^Ur7gy$~t+f)%@"


class LGSoundbar:
    """Direct Music Flow protocol implementation based on goodspeaker Go library"""
    
    def __init__(self, host=HOST, port=PORT):
        self.host = host
        self.port = port
        self.socket = None
        self.client_id = self._generate_client_id()
    
    def _generate_client_id(self):
        """Generate client ID like Go implementation"""
        import zlib
        data = b"goodspeaker/musicflow v0.0.0"
        crc = zlib.crc32(data) & 0xffffffff
        return f"gsm{crc:08x}"
    
    def connect(self):
        """Connect to the soundbar"""
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.socket.settimeout(10)
        self.socket.connect((self.host, self.port))
        return True
    
    def close(self):
        """Close connection"""
        if self.socket:
            self.socket.close()
            self.socket = None
    
    def _create_header(self, payload_length, encrypted=True):
        """Create 5-byte header: 1 byte type + 4 bytes big-endian length"""
        header = bytearray(5)
        header[0] = 0x10 if encrypted else 0x00
        header[1:5] = struct.pack('>I', payload_length)
        return bytes(header)
    
    def _encrypt_payload(self, payload):
        """Encrypt payload using AES-CBC with PKCS7 padding"""
        cipher = AES.new(PROTO_KEY, AES.MODE_CBC, PROTO_IV)
        padded = pad(payload, AES.block_size)
        return cipher.encrypt(padded)
    
    def _decrypt_payload(self, encrypted_payload):
        """Decrypt payload and remove PKCS7 padding"""
        cipher = AES.new(PROTO_KEY, AES.MODE_CBC, PROTO_IV)
        decrypted = cipher.decrypt(encrypted_payload)
        return unpad(decrypted, AES.block_size)
    
    def send_command(self, command, data=None):
        """Send a command to the soundbar"""
        # Build request
        request = {"msg": command}
        if data:
            request["data"] = data
        
        # Serialize to JSON and add newline (like Go implementation)
        payload = json.dumps(request, separators=(',', ':')).encode('utf-8') + b'\n'
        
        # Encrypt payload
        encrypted = self._encrypt_payload(payload)
        
        # Create header and send
        header = self._create_header(len(encrypted), encrypted=True)
        self.socket.send(header + encrypted)
        
        return True
    
    def _read_response(self):
        """Read and parse response"""
        # Read 5-byte header
        header = self.socket.recv(5)
        if len(header) != 5:
            return {"error": "Invalid header"}
        
        msg_type = header[0]
        length = struct.unpack('>I', header[1:5])[0]
        
        # Read payload
        payload = b''
        while len(payload) < length:
            chunk = self.socket.recv(length - len(payload))
            if not chunk:
                break
            payload += chunk
        
        # Decrypt if needed
        if msg_type == 0x10:
            payload = self._decrypt_payload(payload)
        
        # Parse JSON
        return json.loads(payload.decode('utf-8'))
    
    def set_volume(self, volume, fadetime=0):
        """Set volume (0-100)"""
        self.send_command("VOLUME_SETTING", {"vol": volume, "fadetime": fadetime})
        return self._read_response()
    
    def set_mute(self, muted):
        """Mute/unmute"""
        self.send_command("MUTE_SET", {"mute": muted})
        return self._read_response()
    
    def set_night_mode(self, enabled):
        """Toggle night mode"""
        self.send_command("NIGHT_MODE_SET", {"nightmode": enabled})
        return self._read_response()
    
    def set_function(self, func_type):
        """Set input function"""
        self.send_command("FUNCTION_SET", {"type": func_type})
        return self._read_response()
    
    def get_status(self):
        """Get product info"""
        now = datetime.now()
        data = {
            "id": self.client_id,
            "day": now.weekday(),
            "hour": now.hour,
            "min": now.minute,
            "option": 1
        }
        self.send_command("PRODUCT_INFO", data)
        return self._read_response()


def send_command_socket(command, data):
    """Helper to send a single command via socket"""
    sb = LGSoundbar(HOST, PORT)
    try:
        sb.connect()
        
        if command == "VOLUME_SETTING":
            result = sb.set_volume(data.get("vol", 50), data.get("fadetime", 0))
        elif command == "MUTE_SET":
            result = sb.set_mute(data.get("mute", False))
        elif command == "NIGHT_MODE_SET":
            result = sb.set_night_mode(data.get("nightmode", False))
        elif command == "FUNCTION_SET":
            result = sb.set_function(data.get("type", 0))
        else:
            result = {"error": f"Unknown command: {command}"}
        
        sb.close()
        return result
    except Exception as e:
        sb.close()
        return {"error": str(e)}


# === MuFLoCTL Workaround for Status (still needed) ===
MUFLACTL = "/Users/homemacbookpro/go/bin/mufloctl"


def get_soundbar_status():
    """Get soundbar status using mufloctl workaround"""
    output_file = tempfile.mktemp(suffix=".txt")
    
    try:
        import subprocess
        process = subprocess.Popen(
            f"{MUFLACTL} -addr {HOST} -test > {output_file} 2>&1",
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        
        time.sleep(0.5)
        
        if not os.path.exists(output_file):
            return {"error": "Output file not created"}
        
        with open(output_file) as f:
            content = f.read()
        
        for line in content.split('\n'):
            line = line.strip()
            if '"msg":"PRODUCT_INFO"' in line and '"result":"OK"' in line:
                try:
                    if "=> " in line:
                        json_str = line.split("=> ")[1]
                        data = json.loads(json_str)
                        info = data.get("data", {}).get("info", {})
                        
                        function_map = {0: "wifi", 1: "bt", 2: "usb", 3: "aux", 
                                      4: "optical", 6: "hdmi", 7: "arc", 12: "lgtv"}
                        
                        return {
                            "name": info.get("name"),
                            "volume": info.get("vol"),
                            "mute": info.get("mute"),
                            "function": info.get("function"),
                            "nightmode": info.get("nightmode", False),
                            "eq": info.get("eqlist", []),
                            "playing": info.get("playing"),
                            "source": function_map.get(info.get("function", 4), "unknown")
                        }
                except (json.JSONDecodeError, IndexError, KeyError) as e:
                    return {"error": f"Parse error: {e}"}
        
        return {"error": "No valid JSON found"}
        
    except Exception as e:
        return {"error": str(e)}
    finally:
        if os.path.exists(output_file):
            try:
                os.remove(output_file)
            except:
                pass


# === HTTP Handler ===
class SoundbarHandler(BaseHTTPRequestHandler):
    def _send_json(self, status, data):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
    
    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {"status": "ok", "soundbar": HOST})
        elif self.path == "/status":
            result = get_soundbar_status()
            if "error" in result:
                self._send_json(500, result)
            else:
                self._send_json(200, result)
        else:
            self._send_json(404, {"error": "Not found"})
    
    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode() if content_length > 0 else "{}"
        
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            data = {}
        
        if self.path == "/volume":
            result = send_command_socket("VOLUME_SETTING", {"vol": data.get("volume", 50), "fadetime": 0})
            self._handle_result(result, "volume", data.get("volume"))
        elif self.path == "/mute":
            result = send_command_socket("MUTE_SET", {"mute": data.get("muted", False)})
            self._handle_result(result, "mute", data.get("muted"))
        elif self.path == "/nightmode":
            result = send_command_socket("NIGHT_MODE_SET", {"nightmode": data.get("enabled", False)})
            self._handle_result(result, "nightmode", data.get("enabled"))
        elif self.path == "/function":
            source_map = {"wifi": 0, "bt": 1, "bluetooth": 1, "usb": 2, "aux": 3, 
                         "optical": 4, "hdmi": 6, "arc": 7, "lgtv": 12}
            func = source_map.get(data.get("source", "wifi").lower(), 0)
            result = send_command_socket("FUNCTION_SET", {"type": func})
            self._handle_result(result, "function", data.get("source"))
        else:
            self._send_json(404, {"error": "Not found"})
    
    def _handle_result(self, result, command, value):
        if "error" in result:
            self._send_json(500, {"command": command, "value": value, "error": result["error"]})
            return
        
        # Check for success: result="OK" or msg contains "CHANGE" or result is ok
        msg = result.get("msg", "")
        res = result.get("result", "")
        data = result.get("data", {})
        
        if res == "OK" or "CHANGE" in msg or res == "ok":
            self._send_json(200, {"command": command, "value": value, "result": "ok"})
        else:
            self._send_json(200, {"command": command, "value": value, "result": result})
    
    def log_message(self, format, *args):
        pass


def main():
    server = HTTPServer((LISTEN_ADDR, LISTEN_PORT), SoundbarHandler)
    print(f"Soundbar API running on http://{LISTEN_ADDR}:{LISTEN_PORT}")
    print(f"Soundbar at: {HOST}:{PORT}")
    print("\nEndpoints:")
    print("  GET  /status    - Get soundbar status")
    print("  POST /volume    - Set volume (JSON: {\"volume\": 25})")
    print("  POST /mute      - Set mute (JSON: {\"muted\": true})")
    print("  POST /nightmode - Set night mode (JSON: {\"enabled\": true})")
    print("  POST /function  - Set input (JSON: {\"source\": \"hdmi\"})")
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == "__main__":
    main()