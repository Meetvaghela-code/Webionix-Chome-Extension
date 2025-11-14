import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from langchain_community.document_loaders import WebBaseLoader
from langchain_classic.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from langchain_classic.chains import RetrievalQA

# Note: We removed the optional LangChain StringOutputParser to keep
# output processing deterministic. The server now uses StructuredOutputParser
# (when available) and a simple cleaner fallback.

# Optional: try to import StructuredOutputParser / ResponseSchema for structured extraction
try:
    try:
        # Try modern layout first, fallback to classic layout
        try:
            from langchain.output_parsers import StructuredOutputParser, ResponseSchema
        except Exception:
            from langchain_classic.output_parsers import StructuredOutputParser, ResponseSchema

        # Sanity-check that the imported StructuredOutputParser exposes the
        # expected factory methods. LangChain has changed APIs across
        # releases, so be defensive here and fall back if incompatible.
        if not hasattr(StructuredOutputParser, 'from_response_schemas'):
            # Some older/newer variants may not provide the factory we expect.
            raise ImportError('StructuredOutputParser missing from_response_schemas API')

        structured_schemas = [
            ResponseSchema(name='title', description='Main topic or heading extracted from the content.'),
            ResponseSchema(name='sections', description='List of sections with bullet points.'),
        ]

        # Create the structured parser via the supported factory method.
        structured_parser = StructuredOutputParser.from_response_schemas(structured_schemas)

        # format instructions may be provided by the parser instance; guard access
        format_instructions = ''
        try:
            format_instructions = structured_parser.get_format_instructions()
        except Exception:
            # Some implementations may expose instructions differently; keep empty
            format_instructions = ''

        print('Using StructuredOutputParser for extraction.')
    except Exception as inner_ex:
        structured_parser = None
        format_instructions = ''
        print(f'StructuredOutputParser import/initialization failed or incompatible: {inner_ex}; skipping structured extraction.')
except Exception as ex:
    structured_parser = None
    format_instructions = ''
    print(f'StructuredOutputParser not available; skipping structured extraction. ({ex})')


# --- CONFIGURATION ---

# 1. Read your API key from the environment
# Get one from https://aistudio.google.com/app/apikey
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

# 2. Check if the API key is set; warn if missing but continue so the server can start.
if not GOOGLE_API_KEY:
    print("="*80)
    print("WARNING: GOOGLE_API_KEY is not set. The server will start but the Google LLM won't be available.")
    print("To enable the Google LLM, set an API key and restart the server.")
    print("Examples (PowerShell):")
    print("  # session-only:\n  $Env:GOOGLE_API_KEY = 'your-key-here'")
    print("  # persist for user:\n  setx GOOGLE_API_KEY 'your-key-here'")
    print("Or add a .env file and load it in development.")
    print("="*80)

# --- INITIALIZE FLASK & LANGCHAIN COMPONENTS ---

app = Flask(__name__)
# Allow requests from the Chrome extension
CORS(app) 

# Initialize the LLM (Gemini 2.5 Flash)
try:
    llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash-preview-09-2025")
    
    # Initialize the Embeddings model
    # Use a free Hugging Face sentence-transformers model instead of the Google embedding model.
    # This avoids quota/paid-model restrictions and runs locally in the venv.
    try:
        from sentence_transformers import SentenceTransformer

        class HuggingFaceEmbeddingsWrapper:
            """Minimal wrapper exposing embed_documents and embed_query methods
            so it works with langchain/FAISS.from_documents.
            """
            def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
                # instantiate the SentenceTransformer model
                self.model = SentenceTransformer(model_name)

            def embed_documents(self, texts):
                # Accepts a list of strings. Returns list[list[float]].
                # Convert numpy arrays to lists for downstream compatibility.
                embs = self.model.encode(texts, convert_to_numpy=True)
                return [emb.tolist() for emb in embs]

            def embed_query(self, text):
                emb = self.model.encode(text, convert_to_numpy=True)
                return emb.tolist()

            def __call__(self, texts):
                """Allow the wrapper to be callable.

                Some versions of FAISS.from_documents will call the provided
                embeddings object directly (either with a single string or a
                list of strings). Make the wrapper accept both.
                """
                if isinstance(texts, (list, tuple)):
                    return self.embed_documents(texts)
                return self.embed_query(texts)

        embeddings = HuggingFaceEmbeddingsWrapper(model_name="all-MiniLM-L6-v2")
        print("Using Hugging Face sentence-transformers embeddings: all-MiniLM-L6-v2")
    except Exception as he:
        print(f"Error initializing Hugging Face embeddings: {he}")
        embeddings = None

    print("Successfully initialized Google Generative AI models (LLM) and embeddings.")
except Exception as e:
    print(f"Error initializing Google AI models: {e}")
    print("Please ensure your API key is correct and you have internet access.")
    llm = None
    embeddings = None



# --- API ENDPOINT ---

@app.route('/query', methods=['POST'])
def handle_query():
    """
    Handles the /query endpoint.
    Expects a JSON payload with "url" and "question".
    Returns a JSON payload with "answer" or "error".
    """
    if llm is None or embeddings is None:
        return jsonify({"error": "AI models are not initialized. Check server logs."}), 500

    print("\nReceived new query...")
    
    try:
        data = request.json
        url = data.get('url')
        question = data.get('question')

        if not url or not question:
            return jsonify({"error": "Missing 'url' or 'question' in request."}), 400

        print(f"  URL: {url}")
        print(f"  Question: {question}")

        # --- THE LANGCHAIN LOGIC ---

        # 1. Load the document
        print("  Step 1: Loading document from web...")
        loader = WebBaseLoader(url)
        docs = loader.load()

        # 2. Split the document into chunks
        print("  Step 2: Splitting document into chunks...")
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=2000, 
            chunk_overlap=200
        )
        splits = text_splitter.split_documents(docs)

        # 3. Create a vector store (in-memory)
        print("  Step 3: Creating in-memory vector store...")
        vectorstore = FAISS.from_documents(splits, embeddings)

        # 4. Create the RetrievalQA chain
        # This chain finds relevant text chunks (retrieval) and passes them
        # to the LLM to generate an answer (QA).
        print("  Step 4: Creating RetrievalQA chain...")
        qa_chain = RetrievalQA.from_chain_type(
            llm=llm,
            chain_type="stuff", # "stuff" means it "stuffs" all chunks into one prompt
            retriever=vectorstore.as_retriever()
        )

        # 5. Invoke the chain and get the result
        print("  Step 5: Invoking chain...")
        raw_answer = qa_chain.invoke({ "query": question })
        answer_text = raw_answer.get("result", "")
    finally:
        pass

        # We'll produce a consistent JSON shape for the frontend:
        # {
        #   "answer": string (concise human-friendly answer),
        #   "raw": object (original chain output or result),
        #   "structured": object|null (structured parse result when available)
        # }

        # Normalize the raw chain output into a JSON-serializable object
        if isinstance(raw_answer, dict):
            raw_clean = raw_answer
        else:
            raw_clean = {"result": str(raw_answer)}

        # Enforce structured-only behavior: require structured_parser to be present
        if structured_parser is None:
            return jsonify({
                "error": "StructuredOutputParser is not available on the server. Install a compatible LangChain variant."
            }), 500

        # Build a prompt to ask the LLM to reformat the answer according to
        # the format_instructions produced by the structured parser.
        try:
            structured_prompt = (
                " Reform the following into EXACT schema:"
                f"Answer:\n{answer_text}\n\n"
                f"Schema:\n{format_instructions}\n\n"
                
            )

            # Invoke the LLM to get a structured-formatted string
            structured_result = llm.invoke(structured_prompt)
            structured_output = getattr(structured_result, 'content', str(structured_result))

            # Parse the structured output into a dict/list
            parsed = structured_parser.parse(structured_output)

            # Ensure parsed is structured
            if not isinstance(parsed, (dict, list)):
                return jsonify({"error": "StructuredOutputParser did not return structured data."}), 500

            # Derive a short human-friendly answer from structured data when possible
            def _concise_from_structured(obj):
                try:
                    import json
                    if isinstance(obj, dict):
                        if 'answer' in obj and obj['answer']:
                            return str(obj['answer']).strip()
                        if 'summary' in obj and obj['summary']:
                            return str(obj['summary']).strip()
                        title = obj.get('title') or obj.get('heading')
                        sections = obj.get('sections') or obj.get('bullets') or obj.get('body')
                        if title and sections:
                            first = sections[0] if isinstance(sections, list) and sections else sections
                            return f"{title}: {first}"
                        vals = [json.dumps(v, ensure_ascii=False) if isinstance(v, (list, dict)) else str(v) for v in obj.values() if v]
                        return ' '.join(vals)[:2000]
                    elif isinstance(obj, list):
                        items = [str(x) for x in obj if x]
                        return ' '.join(items[:5])
                except Exception:
                    return None
                return None

            concise = _concise_from_structured(parsed) or ""

            return jsonify({
                "answer": concise,
                "raw": raw_clean,
                "structured": parsed
            })

        except Exception as e:
            print(f"  Error during structured formatting/parsing: {e}")
            return jsonify({"error": str(e)}), 500

@app.route('/ping', methods=['GET'])
def ping():
    """Lightweight health check for the extension to query."""
    return jsonify({"status": "ok"}), 200


@app.route('/health', methods=['GET'])
def health():
    """Return initialization status of LLM and embeddings."""
    return jsonify({
        "llm_initialized": llm is not None,
        "embeddings_initialized": embeddings is not None,
    }), 200

if __name__ == '__main__':
    app.run(debug=True)