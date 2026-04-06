import os
import json
from typing import List, Optional

from openai import OpenAI
from dotenv import load_dotenv
from .llm_prompt import DB_SCHEMA_analyze

load_dotenv(dotenv_path="../.env")
api_key = os.getenv("OPENAI_API_KEY")
client = OpenAI(api_key=api_key)

