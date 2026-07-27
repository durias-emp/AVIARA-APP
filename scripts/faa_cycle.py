"""Shared helpers for the FAA's 28-day NASR subscription.

The cycle is worked out from the date rather than pinned: 9 Jul 2026 was an
effective date and every cycle since is a multiple of 28 days from it. Pinning
it means the data quietly goes stale four weeks after anyone last looked.
"""
import os
import urllib.request
import zipfile
from datetime import date, timedelta

NASR_BASE = 'https://nfdc.faa.gov/webContent/28DaySub/extra'
NASR_EPOCH = date(2026, 7, 9)

CACHE = os.environ.get('AVIARA_CACHE') or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.cache')


def current_cycle(today=None):
    today = today or date.today()
    return NASR_EPOCH + timedelta(days=28 * ((today - NASR_EPOCH).days // 28))


def cycle_tag(d):
    return d.strftime('%d_%b_%Y')


def download(path, url):
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        print(f'  downloading {os.path.basename(path)}…')
        urllib.request.urlretrieve(url, path)
    return path


def nasr_subset(subset, cache=None):
    """Fetch and unzip a NASR subset (APT, FIX, NAV, AWY, FRQ) for the current
    cycle, stepping back one cycle if the FAA has not posted it yet — a
    four-week-old official file beats a failed build that leaves the app on
    data months older.

    Returns (directory, cycle_tag).
    """
    cache = cache or CACHE
    override = os.environ.get('NASR_CYCLE')
    tags = [override] if override else [cycle_tag(current_cycle()),
                                        cycle_tag(current_cycle() - timedelta(days=28))]
    for tag in tags:
        zip_path = os.path.join(cache, 'nasr', f'{tag}_{subset}.zip')
        dest = os.path.join(cache, 'nasr', f'{tag}_{subset}')
        try:
            download(zip_path, f'{NASR_BASE}/{tag}_{subset}_CSV.zip')
        except Exception as exc:                      # noqa: BLE001 — any HTTP failure
            print(f'  {tag} {subset}: {exc}')
            if os.path.exists(zip_path):
                os.remove(zip_path)
            continue
        if not os.path.isdir(dest):
            with zipfile.ZipFile(zip_path) as z:
                z.extractall(dest)
        return dest, tag
    raise SystemExit(f'NASR {subset} unavailable for this cycle and the last')
