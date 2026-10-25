"""One-time private catalogue import; never discovers or contacts services."""
import argparse
import json
from pathlib import Path

from .launchpad import Launchpad


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', type=Path, default=Path('./data/dashboard.sqlite'))
    parser.add_argument('--catalog', type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.catalog.stat().st_size > 2_000_000:
            raise ValueError('Каталог слишком большой')
        data = json.loads(args.catalog.read_text())
        records = data.get('applications') if isinstance(data, dict) else data
        result = Launchpad(args.data).import_applications(records)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    print(json.dumps(result))


if __name__ == '__main__':
    main()
