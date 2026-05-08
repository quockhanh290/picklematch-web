import os, re

dirs_to_scan = [r'c:\Users\quock\OneDrive\picklematch-vn\app', r'c:\Users\quock\OneDrive\picklematch-vn\components']

count = 0
for d in dirs_to_scan:
    for root, _, files in os.walk(d):
        for file in files:
            if file.endswith('.tsx') or file.endswith('.ts'):
                filepath = os.path.join(root, file)
                with open(filepath, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                # Check for the pattern 'import {\nimport { RADIUS'
                if re.search(r'import\s*\{\r?\nimport\s*\{\s*(RADIUS|SPACING)', content):
                    
                    new_content = re.sub(
                        r'import\s*\{\r?\n(import\s*\{\s*(?:RADIUS|SPACING)[^\n]*from[^\n]*screenLayout[^\n]*)',
                        r'\1\nimport {',
                        content
                    )
                    
                    with open(filepath, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    print(f'Fixed broken import in {filepath}')
                    count += 1

print(f'Total files fixed: {count}')
