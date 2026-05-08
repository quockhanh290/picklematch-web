import os
import re

app_dir = r'c:\Users\quock\OneDrive\picklematch-vn'
target_dirs = ['app', 'components', 'lib', 'hooks', 'constants']

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    orig_content = content
    
    # 1. Update tailwind rounded classes
    content = re.sub(r'rounded-\[28px\]', 'rounded-[24px]', content)
    content = re.sub(r'rounded-\[30px\]', 'rounded-[24px]', content)
    content = re.sub(r'rounded-\[32px\]', 'rounded-[24px]', content)
    content = re.sub(r'rounded-\[34px\]', 'rounded-[24px]', content)
    content = re.sub(r'rounded-\[40px\]', 'rounded-full', content)
    content = re.sub(r'rounded-\[18px\]', 'rounded-[20px]', content)
    
    # 2. Update style={{ borderRadius: X }}
    content = re.sub(r'borderRadius:\s*34\b', 'borderRadius: RADIUS.hero', content)
    content = re.sub(r'borderRadius:\s*32\b', 'borderRadius: RADIUS.hero', content)
    content = re.sub(r'borderRadius:\s*30\b', 'borderRadius: RADIUS.hero', content)
    content = re.sub(r'borderRadius:\s*29\b', 'borderRadius: RADIUS.hero', content)
    content = re.sub(r'borderRadius:\s*28\b', 'borderRadius: RADIUS.hero', content)
    content = re.sub(r'borderRadius:\s*24\b', 'borderRadius: RADIUS.hero', content)
    content = re.sub(r'borderRadius:\s*22\b', 'borderRadius: RADIUS.xl', content)
    content = re.sub(r'borderRadius:\s*20\b', 'borderRadius: RADIUS.xl', content)
    content = re.sub(r'borderRadius:\s*18\b', 'borderRadius: RADIUS.xl', content)
    content = re.sub(r'borderRadius:\s*16\b', 'borderRadius: RADIUS.lg', content)
    content = re.sub(r'borderRadius:\s*14\b', 'borderRadius: RADIUS.md', content)
    content = re.sub(r'borderRadius:\s*12\b', 'borderRadius: RADIUS.md', content)
    content = re.sub(r'borderRadius:\s*10\b', 'borderRadius: RADIUS.sm', content)
    content = re.sub(r'borderRadius:\s*8\b', 'borderRadius: RADIUS.sm', content)
    
    # 3. Update style={{ borderWidth: X }}
    content = re.sub(r'borderWidth:\s*0\.5\b', 'borderWidth: BORDER.hairline', content)
    content = re.sub(r'borderWidth:\s*1\b', 'borderWidth: BORDER.base', content)
    content = re.sub(r'borderWidth:\s*1\.5\b', 'borderWidth: BORDER.medium', content)
    content = re.sub(r'borderWidth:\s*2\b', 'borderWidth: BORDER.thick', content)
    content = re.sub(r'borderWidth:\s*3\b', 'borderWidth: BORDER.heavy', content)

    # 4. Insert import if RADIUS or BORDER is used and not imported
    if ('RADIUS.' in content or 'BORDER.' in content or 'SHADOW.' in content or 'BUTTON.' in content) and 'screenLayout' not in content:
        # Find the last import
        imports_end = content.rfind('import ')
        if imports_end != -1:
            next_newline = content.find('\n', imports_end)
            if next_newline != -1:
                import_stmt = "\nimport { RADIUS, BORDER, SHADOW, SPACING, BUTTON } from '@/constants/screenLayout'"
                content = content[:next_newline+1] + import_stmt + content[next_newline+1:]
        
    if orig_content != content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return True
    return False

modified_count = 0
for d in target_dirs:
    for root, _, files in os.walk(os.path.join(app_dir, d)):
        for file in files:
            if file.endswith(('.tsx', '.ts')) and 'screenLayout.ts' not in file:
                filepath = os.path.join(root, file)
                try:
                    if process_file(filepath):
                        modified_count += 1
                        print(f'Updated {file}')
                except Exception as e:
                    print(f"Failed to process {file}: {e}")

print(f'Total files modified: {modified_count}')
