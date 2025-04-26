import os
import time
import re
from flask import Flask, session, request, redirect, url_for, jsonify, render_template
from flask_session import Session
import spotipy
from spotipy.oauth2 import SpotifyOAuth
from dotenv import load_dotenv
import musicbrainzngs # Still present in user's uploaded file
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderServiceError
import wikipediaapi
import concurrent.futures  # For parallel processing
import functools  # For advanced caching
import json  # For disk caching
import hashlib  # For cache key generation
from datetime import datetime, timedelta  # For cache expiration
import requests
from bs4 import BeautifulSoup

# Load environment variables
load_dotenv()

# Initialize Flask App
app = Flask(__name__, template_folder='templates', static_folder='static')

# Configure Flask-Session
app.config['SESSION_TYPE'] = 'filesystem'
app.config['SECRET_KEY'] = os.getenv('FLASK_SECRET_KEY')
if not app.config['SECRET_KEY']:
    raise ValueError("No FLASK_SECRET_KEY set. Set it in your .env file.")
Session(app)

# --- Configure External APIs ---
# MusicBrainz
try:
    musicbrainzngs.set_useragent(
        "MusicGeoMapApp", "0.1", os.getenv("CONTACT_EMAIL", "default@example.com")
    )
except TypeError as e:
     print(f"Warning: Could not set MusicBrainz user agent: {e}")

# Geopy (Nominatim)
geolocator = Nominatim(user_agent="MusicGeoMapApp/0.1")

# --- Wikipedia ---
WIKI_CONTACT_EMAIL = os.getenv("CONTACT_EMAIL", "default@example.com")
wiki_wiki = wikipediaapi.Wikipedia(
    f'MusicGeoMapApp/0.1 ({WIKI_CONTACT_EMAIL})', 'en'
)

# --- Improved Persistent Caching ---
CACHE_DIR = os.path.join(os.path.dirname(__file__), "cache")
os.makedirs(CACHE_DIR, exist_ok=True)
ARTIST_CACHE_FILE = os.path.join(CACHE_DIR, "artist_location_cache.json")
GEOCODE_CACHE_FILE = os.path.join(CACHE_DIR, "geocode_cache.json")
MB_CACHE_FILE = os.path.join(CACHE_DIR, "musicbrainz_cache.json")
WIKI_CACHE_FILE = os.path.join(CACHE_DIR, "wikipedia_cache.json")
CACHE_EXPIRY_DAYS = 30

def load_cache(cache_file):
    try:
        if os.path.exists(cache_file):
            with open(cache_file, 'r') as f: return json.load(f)
    except Exception as e: print(f"Error loading cache from {cache_file}: {e}")
    return {}

def save_cache(cache_data, cache_file):
    try:
        with open(cache_file, 'w') as f: json.dump(cache_data, f)
    except Exception as e: print(f"Error saving cache to {cache_file}: {e}")

artist_location_cache = load_cache(ARTIST_CACHE_FILE)
geocode_cache = load_cache(GEOCODE_CACHE_FILE)
musicbrainz_cache = load_cache(MB_CACHE_FILE)
wikipedia_cache = load_cache(WIKI_CACHE_FILE)

def save_caches_to_disk():
    save_cache(artist_location_cache, ARTIST_CACHE_FILE)
    save_cache(geocode_cache, GEOCODE_CACHE_FILE)
    save_cache(musicbrainz_cache, MB_CACHE_FILE)
    save_cache(wikipedia_cache, WIKI_CACHE_FILE)

def timed_cache(cache_dict, expiry_days=CACHE_EXPIRY_DAYS):
    def decorator(func):
        @functools.wraps(func)
        def wrapper(key, *args, **kwargs):
            now = datetime.now().isoformat()
            if not isinstance(key, str):
                try: key_str = json.dumps(key, sort_keys=True)
                except TypeError: key_str = str(key)
                cache_key = hashlib.md5(key_str.encode()).hexdigest()
            else: cache_key = key
            cached_item = cache_dict.get(cache_key)
            if cached_item and 'timestamp' in cached_item:
                try:
                    cached_time = datetime.fromisoformat(cached_item['timestamp'])
                    if cached_time + timedelta(days=expiry_days) > datetime.now():
                        # print(f"Cache hit for key: {cache_key[:20]}...") # DEBUG
                        return cached_item['data']
                except ValueError: pass # Ignore invalid timestamp
            result = func(key, *args, **kwargs)
            cache_dict[cache_key] = {'data': result, 'timestamp': now}
            return result
        return wrapper
    return decorator

# --- Spotify Configuration ---
SPOTIPY_CLIENT_ID = os.getenv('SPOTIPY_CLIENT_ID')
SPOTIPY_CLIENT_SECRET = os.getenv('SPOTIPY_CLIENT_SECRET')
SPOTIPY_REDIRECT_URI = os.getenv('SPOTIPY_REDIRECT_URI')
SCOPE = 'user-top-read'

# --- Helper Functions ---
def create_spotify_oauth():
    redirect_uri = SPOTIPY_REDIRECT_URI or url_for('callback', _external=True)
    if not all([SPOTIPY_CLIENT_ID, SPOTIPY_CLIENT_SECRET, redirect_uri]):
        raise ValueError("Spotify API credentials missing.")
    return SpotifyOAuth(client_id=SPOTIPY_CLIENT_ID, client_secret=SPOTIPY_CLIENT_SECRET, redirect_uri=redirect_uri, scope=SCOPE)

def get_token():
    token_info = session.get('token_info', None)
    if not token_info: return None
    now = int(time.time())
    is_expired = token_info.get('expires_at', 0) - now < 60
    if is_expired:
        print("Token expired, attempting refresh.")
        sp_oauth = create_spotify_oauth()
        try:
            token_info = sp_oauth.refresh_access_token(token_info.get('refresh_token'))
            session['token_info'] = token_info; print("Token refreshed.")
        except Exception as e: print(f"Error refreshing token: {e}"); session.clear(); return None
    return token_info

# --- Wikipedia Summary Parsing (Fallback - Kept for now but not used in primary logic) ---
def extract_location_from_wiki(summary):
    # This function remains but might not be called if Wiki Infobox/MB provide results
    if not summary: return None
    patterns = [
        r"(?:born|from|origin|based|formed)\s+(?:in|near)\s+([\w\s,'-]+\s*,\s*[\w\s,'-]+)",
        r"(?:musical group|band)\s+formed\s+in\s+([\w\s,'-]+\s*,\s*[\w\s,'-]+)",
        r"([\w\s,'-]+\s*,\s*(?:United States|USA|U\.S\.A\.|UK|Canada|Australia|Ireland|Germany|France|Italy|Spain|Japan|South Korea|Brazil|Mexico|Argentina|Sweden|Norway|Denmark|Netherlands))",
        r"([\w\s,'-]+\s*,\s*[\w\s,'-]+)"
    ]
    for pattern in patterns:
        match = re.search(pattern, summary, re.IGNORECASE)
        if match:
            location = match.group(1).strip().strip(',. ')
            if len(location) > 4 and not location.isdigit() and not re.search(r'\b(?:Records|Labels|LLC|Inc|Ltd)\b', location, re.IGNORECASE):
                print(f"    [Summary Parse] Found potential location: '{location}' with pattern: {pattern}")
                return location
    print(f"    [Summary Parse] No location found in summary.")
    return None

# --- Improved Location Extraction from MusicBrainz Data ---
def extract_location_from_mb(mb_artist):
    """Extract the most specific location information from MusicBrainz artist data."""
    if not mb_artist:
        return {"specific": None, "country": None}
    
    locations = {
        "area": None,           # Current/primary area
        "begin_area": None,     # Birth/formation area
        "country": None,        # Country
    }
    
    # Extract area (current/primary location)
    if mb_artist.get('area'):
        area = mb_artist['area'].get('name')
        if area:
            locations["area"] = area
    
    # Extract begin-area (birth/formation location)
    if mb_artist.get('begin-area'):
        begin_area = mb_artist['begin-area'].get('name')
        if begin_area:
            locations["begin_area"] = begin_area
    
    # Extract country
    if mb_artist.get('country'):
        locations["country"] = mb_artist['country']
    
    # For specific location, prioritize area with more detail
    specific_location = None
    
    # First priority: begin-area + country (e.g., "Helsinki, Finland")
    if locations["begin_area"] and locations["country"]:
        specific_location = f"{locations['begin_area']}, {locations['country']}"
    
    # Second priority: area + country
    elif locations["area"] and locations["country"]:
        specific_location = f"{locations['area']}, {locations['country']}"
    
    # Third priority: begin-area only
    elif locations["begin_area"]:
        specific_location = locations["begin_area"]
    
    # Fourth priority: area only
    elif locations["area"]:
        specific_location = locations["area"]
    
    # Return both the specific location and the country as fallback
    return {
        "specific": specific_location,
        "country": locations["country"]
    }

# --- MusicBrainz Lookup ---
@timed_cache(musicbrainz_cache)
def get_musicbrainz_data(artist_name):
    """Enhanced MusicBrainz lookup that properly extracts all location data."""
    if not artist_name: 
        return None
    
    print(f"  [MB] Querying MusicBrainz for: '{artist_name}'")

    try:
        time.sleep(0.5)  # Rate limiting
        
        # Initial search to find the MusicBrainz ID
        result = musicbrainzngs.search_artists(artist=artist_name, limit=3)
        
        if not result or not result.get('artist-list'):
            print(f"  [MB] No results found.")
            return None
            
        artist_list = result['artist-list']
        
        # Find the best match - prefer exact name matches
        exact_matches = [a for a in artist_list if a.get('name', '').lower() == artist_name.lower()]
        
        if exact_matches:
            best_match = sorted(exact_matches, key=lambda x: int(x.get('ext:score', 0)), reverse=True)[0]
            artist_id = best_match.get('id')
            print(f"  [MB] Found exact match: {best_match.get('name')} (Score: {best_match.get('ext:score')})")
        else:
            # If no exact match, use the highest scored match
            sorted_results = sorted(artist_list, key=lambda x: int(x.get('ext:score', 0)), reverse=True)
            if not sorted_results:
                print(f"  [MB] Results found but couldn't determine best match.")
                return None
                
            best_match = sorted_results[0]
            artist_id = best_match.get('id')
            print(f"  [MB] Found best match (highest score): {best_match.get('name')} (Score: {best_match.get('ext:score')})")
        
        # Important: Get the full artist data using the lookup method
        # The search results don't contain all the data we need
        if artist_id:
            print(f"  [MB] Looking up full artist data with ID: {artist_id}")
            time.sleep(0.5)  # Rate limiting
            try:
                full_artist_data = musicbrainzngs.get_artist_by_id(artist_id, includes=["url-rels", "aliases"])
                if full_artist_data and 'artist' in full_artist_data:
                    return full_artist_data['artist']  # Return the complete artist data
                else:
                    print(f"  [MB] Couldn't get full artist data.")
                    return best_match  # Fallback to search result
            except Exception as e:
                print(f"  [MB] Error fetching full artist data: {e}")
                return best_match  # Fallback to search result
        else:
            print(f"  [MB] No artist ID found in best match.")
            return best_match  # Use the search result
            
    except Exception as e:
        print(f"  [MB] MusicBrainz error for '{artist_name}': {e}")
        return None

# --- Wikipedia Infobox Parsing ---
@timed_cache(wikipedia_cache, expiry_days=7)
def get_wikipedia_origin(artist_name):
    """Extract artist origin directly from Wikipedia infobox."""
    if not artist_name: return None
    print(f"  [Wiki Infobox] Fetching/Parsing for: '{artist_name}'")
    try:
        artist_name_formatted = artist_name.replace(' ', '_')
        url = f"https://en.wikipedia.org/wiki/{artist_name_formatted}"
        headers = {'User-Agent': f'MusicGeoMapApp/0.1 ({WIKI_CONTACT_EMAIL})'}
        response = requests.get(url, headers=headers, timeout=10)
        if not response.ok:
            print(f"  [Wiki Infobox] Page not found or error: {response.status_code}")
            return None

        soup = BeautifulSoup(response.text, 'html.parser')
        infobox = soup.find('table', class_=re.compile(r'\binfobox\b', re.IGNORECASE))
        if not infobox:
            print(f"  [Wiki Infobox] No infobox table found.")
            return None

        location_keys = ['origin', 'born', 'birth place', 'hometown', 'founded', 'location']
        origin = None
        for row in infobox.find_all('tr'):
            header = row.find('th')
            if header:
                header_text = header.get_text(strip=True).lower()
                if header_text in location_keys:
                    value_cell = row.find('td')
                    if value_cell:
                        raw_text = value_cell.get_text(separator=' ', strip=True)
                        cleaned_text = re.sub(r'\s*\[\d+\]', '', raw_text).strip()
                        origin_candidate = cleaned_text.split('\n')[0].split('(')[0].strip().strip(',. ')
                        if origin_candidate and len(origin_candidate) > 2:
                            print(f"  [Wiki Infobox] Found key '{header_text}', extracted origin: '{origin_candidate}'")
                            origin = origin_candidate
                            break # Found one, stop looking

        if not origin: print(f"  [Wiki Infobox] Relevant keys not found or no value extracted.")
        return origin
    except Exception as e:
        print(f"  [Wiki Infobox] Error for '{artist_name}': {e}")
        return None

# --- Geocoding ---
@timed_cache(geocode_cache)
def geocode_location(place_name):
    if not place_name: return None
    place_name_cleaned = re.sub(r'\s*\(.*?\)\s*', '', place_name).strip().strip(',. ')
    if not place_name_cleaned: return None
    print(f"    [Geocode] Attempting to geocode: '{place_name_cleaned}' (Original: '{place_name}')")
    try:
        time.sleep(0.75) # Be nice to Nominatim
        location = geolocator.geocode(place_name_cleaned, timeout=10)
        if location:
            coords = {"lat": location.latitude, "lon": location.longitude}
            print(f"    [Geocode] SUCCESS: {coords}")
            return coords
        else:
            print(f"    [Geocode] FAILED: No results from Nominatim.")
            return None
    except GeocoderTimedOut: print(f"    [Geocode] TIMEOUT for '{place_name_cleaned}'"); return None
    except GeocoderServiceError as e: print(f"    [Geocode] SERVICE ERROR for '{place_name_cleaned}': {e}"); return None
    except Exception as e: print(f"    [Geocode] UNEXPECTED ERROR for '{place_name_cleaned}': {e}"); return None

# --- Artist Location Processing ---
# --- Updated Process Artist Location Function ---
def process_artist_location(artist_name, spotify_data=None):
    """Enhanced artist location processing with improved MusicBrainz handling."""
    print(f"--- Processing START: {artist_name} ---")
    if not artist_name:
        return None

    # Initialize result tracking
    location_results = {
        "wiki_infobox": None,
        "mb_specific": None,
        "mb_country": None
    }
    location_source = "None"  # Default source
    origin_name_final = None
    coords = None

    # 1. Try Wikipedia Infobox first (Primary source)
    wiki_origin = get_wikipedia_origin(artist_name)
    if wiki_origin:
        location_results["wiki_infobox"] = wiki_origin
        print(f"  Result from Wiki Infobox: '{wiki_origin}'")
    else:
        print(f"  Wiki Infobox returned no results")

    # 2. Get MusicBrainz data with improved lookup
    mb_artist = get_musicbrainz_data(artist_name)
    if mb_artist:
        # Use the enhanced extraction function
        mb_locations = extract_location_from_mb(mb_artist)
        
        if mb_locations["specific"]:
            location_results["mb_specific"] = mb_locations["specific"]
            print(f"  Result from MusicBrainz (Specific): '{mb_locations['specific']}'")
        
        if mb_locations["country"]:
            location_results["mb_country"] = mb_locations["country"]
            print(f"  Result from MusicBrainz (Country): '{mb_locations['country']}'")
    else:
        print(f"  MusicBrainz returned no results")

    # 3. Determine best location string using a clearer priority order
    # Priority: Wiki Infobox > MB Specific > MB Country
    candidate_locations = []
    
    # Add locations in order of preference
    if location_results["wiki_infobox"]:
        candidate_locations.append((location_results["wiki_infobox"], "Wikipedia Infobox"))
    if location_results["mb_specific"]:
        candidate_locations.append((location_results["mb_specific"], "MusicBrainz Specific"))
    if location_results["mb_country"]:
        candidate_locations.append((location_results["mb_country"], "MusicBrainz Country"))
    
    # 4. Try geocoding each candidate in preference order
    for location_string, source in candidate_locations:
        if not location_string:
            continue
            
        # Clean the location string before geocoding
        clean_location = clean_location_string(location_string)
        print(f"  Attempting geocoding for: '{clean_location}' (Source: {source})")
        
        # Try geocoding
        coords = geocode_location(clean_location)
        if coords:
            origin_name_final = clean_location
            location_source = source
            print(f"  Geocoding successful: {coords}")
            break  # Stop trying candidates once we have coordinates
        else:
            print(f"  Geocoding failed for: '{clean_location}'")
    
    # 5. Prepare the result with all available data
    location_data = {
        "name": artist_name,
        "origin": origin_name_final,
        "lat": coords["lat"] if coords else None,
        "lon": coords["lon"] if coords else None,
        "location_source": location_source
    }
    
    # Add Spotify data if available
    if spotify_data:
        location_data.update(spotify_data)
    else:
        location_data.setdefault('genres', [])
        location_data.setdefault('spotify_url', None)
        location_data.setdefault('image_url', None)
        location_data.setdefault('uri', None)

    # Special debugging for problem artists like "Arppa"
    if artist_name.lower() == "arppa" or (location_data['lat'] is None and location_data['origin'] is None):
        print(f"--- SPECIAL DEBUG for {artist_name} ---")
        print(f"  Wiki origin: {wiki_origin}")
        print(f"  MB data available: {bool(mb_artist)}")
        if mb_artist:
            print(f"  MB area: {mb_artist.get('area', {}).get('name')}")
            print(f"  MB begin-area: {mb_artist.get('begin-area', {}).get('name')}")
            print(f"  MB country: {mb_artist.get('country')}")
        print(f"  Final location candidates: {candidate_locations}")
        print(f"--- END SPECIAL DEBUG ---")

    print(f"--- Processing END: {artist_name} -> Origin='{location_data['origin']}', Source='{location_data['location_source']}', Coords=({location_data['lat']}, {location_data['lon']}) ---")
    return location_data

def clean_location_string(location):
    """Clean and standardize location strings for better geocoding results."""
    if not location:
        return None
        
    # Remove parenthetical text
    cleaned = re.sub(r'\s*\(.*?\)\s*', '', location)
    
    # Remove footnote references like [1]
    cleaned = re.sub(r'\s*\[\d+\]', '', cleaned)
    
    # Standardize commas and whitespace
    cleaned = re.sub(r'\s+', ' ', cleaned).strip().strip(',. ')
    
    return cleaned if cleaned else None

# --- Enhanced Geocoding ---
@timed_cache(geocode_cache)
def geocode_location(place_name):
    """Enhanced geocoding with better error handling and normalization."""
    if not place_name:
        return None
        
    print(f"    [Geocode] Attempting to geocode: '{place_name}'")
    
    # Don't retry if we previously failed on this exact string
    # This creates a "negative cache" effect to avoid repeated calls for known failures
    # Implementation detail: timed_cache needs a slight modification to store None values
    
    try:
        time.sleep(0.75)  # Be nice to Nominatim
        
        # First attempt - direct geocoding
        location = geolocator.geocode(place_name, timeout=10)
        
        if location:
            coords = {"lat": location.latitude, "lon": location.longitude}
            print(f"    [Geocode] SUCCESS: {coords}")
            return coords
            
        # No results - try adding "music" qualifier to help Nominatim understand it's a location
        # This can help with band names that are also common words
        if re.search(r"\b(?:band|group|musician|singer)\b", place_name, re.IGNORECASE) is None:
            print(f"    [Geocode] First attempt failed, trying with music qualifier...")
            alt_place = f"{place_name} music"
            location = geolocator.geocode(alt_place, timeout=10)
            
            if location:
                coords = {"lat": location.latitude, "lon": location.longitude}
                print(f"    [Geocode] SUCCESS with music qualifier: {coords}")
                return coords
        
        print(f"    [Geocode] FAILED: No results from Nominatim.")
        return None
        
    except GeocoderTimedOut:
        print(f"    [Geocode] TIMEOUT for '{place_name}'")
        return None
    except GeocoderServiceError as e:
        print(f"    [Geocode] SERVICE ERROR for '{place_name}': {e}")
        return None
    except Exception as e:
        print(f"    [Geocode] UNEXPECTED ERROR for '{place_name}': {e}")
        return None

# --- Enhanced Batch Processing with Rate Limiting ---
def get_artist_locations(artists_data):
    """Process multiple artists with improved concurrency control and error handling."""
    if not artists_data:
        return []
        
    results = []
    artists_to_process = []
    print(f"--- Batch Processing START for {len(artists_data)} artists ---")

    # Enhanced cache check with smart update for spotify data
    for artist in artists_data:
        artist_name = artist['name']
        spotify_data = {
            'genres': artist.get('genres', []),
            'spotify_url': artist.get('external_urls', {}).get('spotify'),
            'image_url': artist['images'][-1]['url'] if artist.get('images') else None,
            'uri': artist.get('uri')
        }
        
        # Check if we have a valid cached item
        cached_item = artist_location_cache.get(artist_name)
        is_expired = True
        
        if cached_item and 'timestamp' in cached_item:
            try:
                cached_time = datetime.fromisoformat(cached_item['timestamp'])
                if cached_time + timedelta(days=CACHE_EXPIRY_DAYS) > datetime.now():
                    is_expired = False
            except ValueError:
                pass
                
        if cached_item and not is_expired and cached_item.get('data', {}).get('lat') is not None:
            # Only use cache if it actually has coordinates
            cached_data = cached_item['data']
            # Update with fresh Spotify data (they might have changed their profile pic, etc.)
            cached_data.update(spotify_data)
            results.append(cached_data)
        else:
            artists_to_process.append((artist_name, spotify_data))

    # Process remaining artists with adaptive concurrency
    if artists_to_process:
        print(f"  Processing {len(artists_to_process)} artists via API calls...")
        
        # Adjust number of workers based on batch size to avoid rate limiting
        max_workers = min(5, max(1, len(artists_to_process) // 3))
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_artist = {
                executor.submit(process_artist_location, name, data): name 
                for name, data in artists_to_process
            }
            
            for future in concurrent.futures.as_completed(future_to_artist):
                artist_name = future_to_artist[future]
                try:
                    location_data = future.result()
                    if location_data:
                        # Don't cache results without coordinates
                        if location_data.get('lat') is not None:
                            artist_location_cache[artist_name] = {
                                'data': location_data,
                                'timestamp': datetime.now().isoformat()
                            }
                        results.append(location_data)
                except Exception as e:
                    print(f"Error processing {artist_name} in parallel thread: {e}")
                    import traceback
                    traceback.print_exc()

    # Save updated caches - but only periodically to reduce disk I/O
    # This approach reduces excessive writes when processing large batches
    save_caches_to_disk()
    
    print(f"--- Batch Processing END. Returning {len(results)} results. ---")
    return results

# --- Flask Routes ---
@app.route('/')
def index():
    token_info = get_token()
    return render_template('index.html', logged_in=bool(token_info))

@app.route('/login')
def login():
    try: sp_oauth = create_spotify_oauth(); auth_url = sp_oauth.get_authorize_url(); return redirect(auth_url)
    except Exception as e: print(f"Login error: {e}"); return "Login Error", 500

@app.route('/callback')
def callback():
    sp_oauth = create_spotify_oauth(); session.clear(); code = request.args.get('code')
    if not code: error = request.args.get('error'); return f"Callback Error: {error}", 400
    try: token_info = sp_oauth.get_access_token(code, check_cache=False); session['token_info'] = token_info; return redirect(url_for('index'))
    except Exception as e: print(f"Token error: {e}"); return f"Token Error: {e}", 500

@app.route('/logout')
def logout():
    session.clear(); return redirect(url_for('index'))

@app.route('/top-artists')
def top_artists():
    token_info = get_token()
    if not token_info: return jsonify({"error": "User not logged in or session expired"}), 401
    valid_time_ranges = ['short_term', 'medium_term', 'long_term']
    time_range = request.args.get('time_range', 'medium_term')
    if time_range not in valid_time_ranges: time_range = 'medium_term'
    print(f"--- API Request START /top-artists?time_range={time_range} ---")
    try:
        sp = spotipy.Spotify(auth=token_info['access_token'])
        results = sp.current_user_top_artists(limit=30, time_range=time_range)
        spotify_artists = results.get('items', [])
        if not spotify_artists:
             print("No top artists from Spotify."); print(f"--- API Request END (No Spotify Artists) ---"); return jsonify([])

        artists_processed_list = get_artist_locations(spotify_artists)

        if artists_processed_list: print(f"Sending back {len(artists_processed_list)} artists. First: {artists_processed_list[0]}")
        else: print("Sending back empty list.")
        print(f"--- API Request END /top-artists ---")
        return jsonify(artists_processed_list)
    except spotipy.exceptions.SpotifyException as e:
        print(f"Spotify API error: {e.http_status} - {e.msg}")
        error_message = e.msg or "Spotify Error"; status_code = e.http_status or 500
        if e.http_status == 429: error_message = "Rate limited by Spotify."
        elif e.http_status in [401, 403]: error_message = "Spotify auth error. Try logout/login."; session.clear()
        print(f"--- API Request END (Spotify Error) ---"); return jsonify({"error": error_message}), status_code
    except Exception as e:
        print(f"Unexpected error in /top-artists: {e}"); import traceback; traceback.print_exc()
        print(f"--- API Request END (Server Error) ---"); return jsonify({"error": "Server error"}), 500

# --- Run the App ---
if __name__ == '__main__':
    host = os.getenv('FLASK_RUN_HOST', '127.0.0.1')
    port = int(os.getenv('FLASK_RUN_PORT', '5000'))
    debug_mode = os.getenv('FLASK_DEBUG', 'True').lower() in ['true', '1', 't']
    print(f"Starting Flask app on {host}:{port} (Debug: {debug_mode})")
    app.run(host=host, port=port, debug=debug_mode)