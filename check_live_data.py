import requests
import json

# Check what data is available in the live endpoint
FPL_BASE_URL = 'https://fantasy.premierleague.com/api'

# Get current gameweek
bootstrap = requests.get(f'{FPL_BASE_URL}/bootstrap-static/').json()
current_gw = next(gw['id'] for gw in bootstrap['events'] if gw['is_current'])

print(f"Current Gameweek: {current_gw}")

# Get live data
live_data = requests.get(f'{FPL_BASE_URL}/event/{current_gw}/live/').json()

# Check a sample player's available stats
if live_data['elements']:
    sample_player = live_data['elements'][0]
    print("\nAvailable stats for a player:")
    print(json.dumps(sample_player['stats'], indent=2))
    
    # Check explain data if available
    if 'explain' in sample_player:
        print("\nExplain data available:")
        print(json.dumps(sample_player['explain'][0] if sample_player['explain'] else {}, indent=2))

# Get fixture data to see what's available
fixtures = requests.get(f'{FPL_BASE_URL}/fixtures/?event={current_gw}').json()
if fixtures:
    print("\nSample fixture data:")
    fixture = fixtures[0]
    print(f"Finished: {fixture.get('finished', 'N/A')}")
    print(f"Finished Provisional: {fixture.get('finished_provisional', 'N/A')}")
    print(f"Started: {fixture.get('started', 'N/A')}")
    print(f"Minutes: {fixture.get('minutes', 'N/A')}")
    
    # Check if we have detailed stats
    if 'stats' in fixture:
        print("\nFixture stats available:")
        for stat in fixture['stats']:
            print(f"- {stat}")