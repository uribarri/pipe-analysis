#!/usr/bin/env python
import os
import sys
import http.server
import socketserver
import webbrowser
import threading
import time

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

def open_browser():
    # Wait 1 second for the server to spin up
    time.sleep(1.0)
    url = f"http://localhost:{PORT}"
    print(f"Opening default web browser to: {url} ...")
    webbrowser.open(url)

def start_server():
    # Allow port reuse to prevent address-already-in-use errors on restarts
    socketserver.TCPServer.allow_reuse_address = True
    
    try:
        with socketserver.TCPServer(("", PORT), Handler) as httpd:
            print(f"\n--- PIPE STRESS ANALYZER WEB DASHBOARD ---")
            print(f"Serving local directory: {DIRECTORY}")
            print(f"Server running at: http://localhost:{PORT}")
            print("Press Ctrl+C to terminate the server.\n")
            
            # Start browser thread
            threading.Thread(target=open_browser, daemon=True).start()
            
            # Run server
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping local server. Goodbye!")
        sys.exit(0)
    except Exception as e:
        print(f"Error starting server: {e}")
        sys.exit(1)

if __name__ == "__main__":
    start_server()
