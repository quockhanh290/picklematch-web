import os, re

dirs_to_scan = [r'c:\Users\quock\OneDrive\picklematch-vn\app', r'c:\Users\quock\OneDrive\picklematch-vn\components']

replacements = {
    r'borderRadius:\s*999': 'borderRadius: RADIUS.full',
    r'borderRadius:\s*32': 'borderRadius: RADIUS.hero',
    r'borderRadius:\s*24': 'borderRadius: RADIUS.xl',
    r'borderRadius:\s*20': 'borderRadius: RADIUS.lg',
    r'borderRadius:\s*14': 'borderRadius: RADIUS.md',
    r'borderRadius:\s*10': 'borderRadius: RADIUS.sm',
    r'borderRadius:\s*6': 'borderRadius: RADIUS.xs',
    r'paddingHorizontal:\s*20': 'paddingHorizontal: SPACING.xl',
    r'paddingVertical:\s*20': 'paddingVertical: SPACING.xl',
    r'padding:\s*20': 'padding: SPACING.xl',
    r'paddingHorizontal:\s*18': 'paddingHorizontal: SPACING.lg',
    r'paddingVertical:\s*18': 'paddingVertical: SPACING.lg',
    r'padding:\s*18': 'padding: SPACING.lg',
    r'paddingHorizontal:\s*14': 'paddingHorizontal: SPACING.md',
    r'paddingVertical:\s*14': 'paddingVertical: SPACING.md',
    r'padding:\s*14': 'padding: SPACING.md',
    r'paddingHorizontal:\s*10': 'paddingHorizontal: SPACING.sm',
    r'paddingVertical:\s*10': 'paddingVertical: SPACING.sm',
    r'padding:\s*10': 'padding: SPACING.sm',
    r'paddingHorizontal:\s*6': 'paddingHorizontal: SPACING.xs',
    r'paddingVertical:\s*6': 'paddingVertical: SPACING.xs',
    r'padding:\s*6': 'padding: SPACING.xs',
}

count = 0
for d in dirs_to_scan:
    for root, _, files in os.walk(d):
        for file in files:
            if file.endswith('.tsx') or file.endswith('.ts'):
                filepath = os.path.join(root, file)
                with open(filepath, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                original_content = content
                
                needs_radius = False
                needs_spacing = False
                
                for k, v in replacements.items():
                    if 'RADIUS' in v and re.search(k, content):
                        content = re.sub(k, v, content)
                        needs_radius = True
                    if 'SPACING' in v and re.search(k, content):
                        content = re.sub(k, v, content)
                        needs_spacing = True
                        
                if content != original_content:
                    has_screenlayout = 'from \'@/constants/screenLayout\'' in content or 'from "@/constants/screenLayout"' in content
                    
                    if not has_screenlayout:
                        imports_to_add = []
                        if needs_radius: imports_to_add.append('RADIUS')
                        if needs_spacing: imports_to_add.append('SPACING')
                        if imports_to_add:
                            import_stmt = f"import {{ {', '.join(imports_to_add)} }} from '@/constants/screenLayout'\n"
                            
                            imports = list(re.finditer(r'^import .*?$', content, re.MULTILINE))
                            if imports:
                                last_import = imports[-1]
                                insert_pos = last_import.end() + 1
                                content = content[:insert_pos] + import_stmt + content[insert_pos:]
                            else:
                                content = import_stmt + content
                    else:
                        # Ensure RADIUS and SPACING are in the import list if they exist
                        import_match = re.search(r'import\s+\{([^}]+)\}\s+from\s+[\'"]@/constants/screenLayout[\'"]', content)
                        if import_match:
                            existing_imports = import_match.group(1).replace(' ', '').split(',')
                            to_add = []
                            if needs_radius and 'RADIUS' not in existing_imports: to_add.append('RADIUS')
                            if needs_spacing and 'SPACING' not in existing_imports: to_add.append('SPACING')
                            
                            if to_add:
                                new_imports = ', '.join(existing_imports + to_add)
                                content = content[:import_match.start(1)] + f" {new_imports} " + content[import_match.end(1):]

                    with open(filepath, 'w', encoding='utf-8') as f:
                        f.write(content)
                    print(f'Updated {os.path.basename(filepath)}')
                    count += 1

print(f'Total files updated: {count}')
