"""
Background Job Queue & Async Task Execution
===========================================
Requirement #16: Non-blocking asynchronous model retraining & data pipeline refresh.
"""
import threading
import queue
import time
from app.utils.logger import logger

_task_queue = queue.Queue()
_task_state = {
    "status": "idle",       # 'idle', 'running', 'completed', 'failed'
    "task_name": None,
    "started_at": None,
    "finished_at": None,
    "last_error": None,
    "version": 0,
}
_state_lock = threading.Lock()


def get_task_status():
    with _state_lock:
        return dict(_task_state)


def set_task_state(status, task_name=None, error=None):
    with _state_lock:
        _task_state["status"] = status
        if task_name:
            _task_state["task_name"] = task_name
        if status == "running":
            _task_state["started_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
            _task_state["finished_at"] = None
            _task_state["last_error"] = None
        elif status in ("completed", "failed"):
            _task_state["finished_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
            if error:
                _task_state["last_error"] = str(error)


def increment_version():
    with _state_lock:
        _task_state["version"] += 1
        return _task_state["version"]


def _worker_loop():
    while True:
        try:
            task_fn, args, kwargs, name = _task_queue.get()
            set_task_state("running", task_name=name)
            logger.info(f"Starting background task: {name}")
            try:
                task_fn(*args, **kwargs)
                set_task_state("completed", task_name=name)
                increment_version()
                logger.info(f"Finished background task: {name}")
            except Exception as e:
                logger.error(f"Error in background task {name}: {e}", exc_info=True)
                set_task_state("failed", task_name=name, error=e)
            finally:
                _task_queue.task_done()
        except Exception as ex:
            logger.error(f"Fatal worker exception: {ex}")
            time.sleep(1)


# Start background worker thread as daemon
_worker_thread = threading.Thread(target=_worker_loop, daemon=True, name="PipelineWorkerThread")
_worker_thread.start()


def enqueue_task(fn, *args, name="Pipeline Task", **kwargs):
    """Enqueue a job to run asynchronously in the background."""
    _task_queue.put((fn, args, kwargs, name))
    logger.info(f"Enqueued task: {name}")
