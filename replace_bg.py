import os, re

def replace_backgrounds(dir_path):
    color_map = {
        '#0d0d15': 'var(--bg-primary)',
        '#0c0c14': 'var(--bg-primary)',
        '#1b1b23': 'var(--bg-elevated)',
        '#1c1c2e': 'var(--bg-elevated)',
        '#13131e': 'var(--bg-secondary)',
        '#13131b': 'var(--bg-secondary)'
    }
    
    for root, dirs, files in os.walk(dir_path):
        for file in files:
            if file.endswith(('.tsx', '.ts', '.css')):
                full_path = os.path.join(root, file)
                try:
                    with open(full_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                except Exception:
                    continue
                
                original = content
                
                # Replace classes like [#0d0d15]
                for hex_val, css_var in color_map.items():
                    # Replace lowercase variant
                    content = re.sub(r'\[\s*' + hex_val + r'\s*\]', f'[{css_var}]', content, flags=re.IGNORECASE)
                    
                    # Handle raw strings
                    content = re.sub(f"'{hex_val}'", f"'{css_var}'", content, flags=re.IGNORECASE)
                    content = re.sub(f'\"{hex_val}\"', f'\"{css_var}\"', content, flags=re.IGNORECASE)

                if content != original:
                    with open(full_path, 'w', encoding='utf-8') as f:
                        f.write(content)
                    print('Updated', full_path)

replace_backgrounds('./src')
