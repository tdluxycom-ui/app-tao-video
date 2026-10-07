from pathlib import Path
import sys
sys.stdout.reconfigure(encoding='utf-8')
lines=Path(sys.argv[1]).read_text(encoding='utf-8').splitlines()
for span in sys.argv[2:]:
    a,b=map(int,span.split(':'))
    print('\n'.join(f'{i+1}: {lines[i]}' for i in range(a-1,min(b,len(lines)))))
