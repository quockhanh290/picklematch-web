import os
import re

app_dir = r'c:\Users\quock\OneDrive\picklematch-vn'
target_dirs = ['app', 'components', 'lib', 'hooks']

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    orig_content = content
    
    # Update manual inline pill button definitions
    # Look for paddingHorizontal: 16, paddingVertical: 8
    content = re.sub(
        r'borderRadius:\s*RADIUS\.full,\s*paddingHorizontal:\s*16,\s*paddingVertical:\s*8',
        r'...BUTTON.pill',
        content
    )
    
    # Remove shadowOpacity: X ... elevation: Y from style
    # Just generic shadows
    content = re.sub(
        r'shadowColor:\s*[^,]+,\s*shadowOffset:\s*\{[^\}]+\},\s*shadowOpacity:\s*[\d\.]+,\s*shadowRadius:\s*[\d\.]+,\s*(?:elevation:\s*\d+,?)?',
        r'...SHADOW.sm,',
        content
    )

    if orig_content != content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return True
    return False

for d in target_dirs:
    for root, _, files in os.walk(os.path.join(app_dir, d)):
        for file in files:
            if file.endswith(('.tsx', '.ts')):
                filepath = os.path.join(root, file)
                try:
                    if process_file(filepath):
                        print(f'Updated button/shadows in {file}')
                except Exception as e:
                    pass

print('Done')
