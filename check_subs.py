import requests
import json

FPL_BASE_URL = 'https://fantasy.premierleague.com/api'

# Get current gameweek
bootstrap = requests.get(f'{FPL_BASE_URL}/bootstrap-static/').json()
current_gw = next(gw['id'] for gw in bootstrap['events'] if gw['is_current'])

# Get fixtures for current gameweek
fixtures = requests.get(f'{FPL_BASE_URL}/fixtures/?event={current_gw}').json()

print(f"Checking fixture data for substitution info (GW{current_gw}):")
print("=" * 60)

# Look at a live or recently finished fixture
for fixture in fixtures[:5]:  # Check first 5 fixtures
    print(f"\n{fixture['team_h']} vs {fixture['team_a']}")
    print(f"Status: Started={fixture.get('started')}, Finished={fixture.get('finished')}, Minutes={fixture.get('minutes', 0)}")
    
    # Check if fixture has detailed stats about subs
    if 'stats' in fixture:
        # Look for substitution related stats
        for stat in fixture['stats']:
            if 'subs' in stat.get('identifier', '').lower() or 'substitut' in stat.get('identifier', '').lower():
                print(f"  Found sub stat: {stat['identifier']}")
                print(f"    Home: {stat.get('h', [])}")
                print(f"    Away: {stat.get('a', [])}")
    
    # Check all available fields
    print(f"  Available fixture fields: {list(fixture.keys())}")
    
    # Check if there's any pulse or event data
    if 'pulse_id' in fixture:
        print(f"  Has pulse_id: {fixture['pulse_id']}")

print("\n" + "=" * 60)
print("Checking for live match event data...")

# Try to get more detailed match data if available
# Check if there's a specific endpoint for live match events
sample_fixture_id = fixtures[0]['id'] if fixtures else None
if sample_fixture_id:
    print(f"\nTrying fixture detail endpoint for fixture {sample_fixture_id}...")
    try:
        # This endpoint might not exist, but worth trying
        detail_url = f'{FPL_BASE_URL}/fixtures/{sample_fixture_id}/'
        response = requests.get(detail_url)
        if response.status_code == 200:
            detail_data = response.json()
            print("Found fixture detail data!")
            print(json.dumps(detail_data, indent=2)[:500])
        else:
            print(f"No fixture detail endpoint (status: {response.status_code})")
    except:
        print("No fixture detail endpoint available")

# Check the live endpoint for more details
print(f"\nChecking live endpoint for player appearance data...")
live_data = requests.get(f'{FPL_BASE_URL}/event/{current_gw}/live/').json()

# See if we can find players who came on as subs
print("\nLooking for substitution patterns in player minutes...")
team_subs = {}

for i, element in enumerate(live_data['elements'][:200]):  # Check first 200 players
    stats = element['stats']
    player_id = i + 1
    
    # Get player info
    player_info = next((p for p in bootstrap['elements'] if p['id'] == player_id), None)
    if not player_info:
        continue
    
    team_id = player_info['team']
    minutes = stats['minutes']
    
    # Track players with specific minute patterns that indicate substitutions
    if minutes > 0 and minutes < 90:
        if team_id not in team_subs:
            team_subs[team_id] = []
        team_subs[team_id].append({
            'name': player_info['web_name'],
            'minutes': minutes,
            'likely_sub': minutes <= 45  # Likely came on as sub if played 45 mins or less
        })

# Show teams with potential subs
for team_id, players in list(team_subs.items())[:3]:
    team_name = next((t['short_name'] for t in bootstrap['teams'] if t['id'] == team_id), 'Unknown')
    print(f"\n{team_name} - Players with < 90 mins:")
    for p in players:
        print(f"  {p['name']}: {p['minutes']} mins {'(likely sub)' if p['likely_sub'] else ''}")
        
print("\n" + "=" * 60)
print("CONCLUSION: The API doesn't directly provide substitution events.")
print("We can only infer from minutes played. Better to remove the 70-min rule.")
print("Stick to: finished games, red cards, and subbed off (minutes < game mins).")