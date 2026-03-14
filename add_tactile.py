import os
import re

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    # Simple regex to find transition-all or hovering buttons
    def replacer(match):
        attrs = match.group(1)
        if 'active:scale-' not in attrs:
            if 'transition-' not in attrs:
                return f'className="{attrs} transition-all active:scale-[0.98] active:translate-y-px"'
            return f'className="{attrs} active:scale-[0.98] active:translate-y-px"'
        return match.group(0)

    # find <button className="..."
    new_content = re.sub(r'className="([^"]+?)"', replacer, content)
    
    # We only want to apply this strictly to <button> or <Link>
    # Actually, simpler: just let's see if we can use global.css for tactile!
