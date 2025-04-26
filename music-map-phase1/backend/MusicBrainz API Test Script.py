import musicbrainzngs
import json
import os
import time
from dotenv import load_dotenv

# --- Configuration ---
# Load environment variables (optional, if you store email there)
load_dotenv()
CONTACT_EMAIL = os.getenv("CONTACT_EMAIL", "your_email@example.com") # Replace with your actual email or load from .env
APP_NAME = "MusicBrainzTestScript"
APP_VERSION = "0.1"

# --- Set User Agent (Required by MusicBrainz API) ---
try:
    musicbrainzngs.set_useragent(
        APP_NAME, APP_VERSION, CONTACT_EMAIL
    )
    print(f"MusicBrainz User-Agent set to: {APP_NAME}/{APP_VERSION} ({CONTACT_EMAIL})")
except TypeError as e:
     print(f"Warning: Could not set MusicBrainz user agent: {e}")
     print("Please ensure you provide a valid contact email.")
     exit() # Exit if user agent can't be set

# --- Function to Test Artist Search ---
def test_musicbrainz_artist(artist_name):
    """
    Searches for an artist on MusicBrainz and prints the raw JSON response.
    First searches for the artist, then gets detailed information including area relationships.
    """
    if not artist_name:
        print("Error: Please provide an artist name.")
        return

    print(f"\n--- Searching MusicBrainz for: '{artist_name}' ---")

    try:
        # Step 1: Search for the artist
        time.sleep(1) # IMPORTANT: Respect MusicBrainz rate limit (1 request per second)
        search_result = musicbrainzngs.search_artists(
            artist=artist_name,
            limit=5
        )
        
        # If we found any artists, get detailed information for the first match
        if search_result['artist-list']:
            artist_id = search_result['artist-list'][0]['id']
            time.sleep(1)  # Respect rate limit
            # Step 2: Get detailed information including area relationships
            result = musicbrainzngs.get_artist_by_id(
                artist_id,
                includes=["aliases", "area-rels"]
            )

        # Print the raw result using json.dumps for pretty printing
        print("\n--- Raw API Response ---")
        print(json.dumps(result, indent=2)) # indent=2 makes it readable

        # Optional: Print key fields from the top match for quick inspection
        if result and result.get('artist-list'):
            print("\n--- Key Fields from Top Match ---")
            top_match = result['artist-list'][0]
            print(f"Name: {top_match.get('name')}")
            print(f"Score: {top_match.get('ext:score')}")
            print(f"Type: {top_match.get('type')}")
            print(f"Country: {top_match.get('country')}")
            print(f"Area: {json.dumps(top_match.get('area'), indent=2)}")
            print(f"Begin Area: {json.dumps(top_match.get('begin-area'), indent=2)}")
            # You can add more fields here if needed

    except musicbrainzngs.WebServiceError as exc:
        print(f"MusicBrainz Web Service Error: {exc}")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")

# --- Example Usage ---
if __name__ == "__main__":
    # --- Artists to Test ---
    test_artists = [
        "Michael Seyer",
        "Clio", # Example from previous logs
        "Half Moon Run", # Example with known location
        "Michael Seyer",
        "MTVKID",
        "L'Impératrice",
        "Courrier Sud",
        "Jaakko Eino Kalevi",
        "Damso",
        "Famous Friend",
        "Alex Nicol",
        "Ocie Elliott",
        "Muddy Monk",
        "Averagekidluke",
        "Mac DeMarco",
        "Kings of Convenience",
        "Dana and Alden",
        "Arppa",
        "Emile Pandolfi",
        "Blankstate."
    ]

    for artist in test_artists:
        test_musicbrainz_artist(artist)
        print("-" * 40) # Separator

    # --- Test with User Input ---
    # while True:
    #     print("\nEnter an artist name to test (or type 'quit' to exit):")
    #     user_input = input("> ")
    #     if user_input.lower() == 'quit':
    #         break
    #     test_musicbrainz_artist(user_input)

