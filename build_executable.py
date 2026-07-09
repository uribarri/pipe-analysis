import os
import sys
import subprocess

def main():
    print("Building standalone executable with PyInstaller...")
    
    # We will build a standalone executable
    # PyInstaller will package fea_engine.py along with report_generator.py and sif_calculator.py
    cmd = [
        "venv/bin/pyinstaller" if os.path.exists("venv/bin/pyinstaller") else "pyinstaller",
        "--onefile",
        "--name=pipe_stress_analyzer",
        "--clean",
        "fea_engine.py"
    ]
    
    print(f"Running command: {' '.join(cmd)}")
    try:
        subprocess.check_call(cmd)
        print("\nExecutable built successfully!")
        print("You can find the compiled executable inside the 'dist' directory.")
    except subprocess.CalledProcessError as e:
        print(f"\nError occurred during compilation: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
