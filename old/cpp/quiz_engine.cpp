#include "quiz_engine.h"
#include <sstream>
#include <algorithm>
#include <random>
#include <chrono>

// Helper to choose k elements from n
static long long choose(int n, int k) {
    if (k < 0 || k > n) return 0;
    if (k == 0 || k == n) return 1;
    if (k > n / 2) k = n - k;
    long long res = 1;
    for (int i = 1; i <= k; i++) {
        res = res * (n - i + 1) / i;
    }
    return res;
}

// Scrabble letter frequencies
static int getLetterFrequency(char c) {
    switch (c) {
        case 'A': return 9; case 'B': return 2; case 'C': return 2;
        case 'D': return 4; case 'E': return 12; case 'F': return 2;
        case 'G': return 3; case 'H': return 2; case 'I': return 9;
        case 'J': return 1; case 'K': return 1; case 'L': return 4;
        case 'M': return 2; case 'N': return 6; case 'O': return 8;
        case 'P': return 2; case 'Q': return 1; case 'R': return 6;
        case 'S': return 4; case 'T': return 6; case 'U': return 4;
        case 'V': return 2; case 'W': return 2; case 'X': return 1;
        case 'Y': return 2; case 'Z': return 1;
        default: return 0;
    }
}

QuizEngine::QuizEngine() 
    : currentQuestionIndex(-1),
      currentQuestionChecked(false),
      totalQuestions(0),
      totalCorrect(0),
      totalMissed(0),
      totalIncorrect(0),
      fullyCorrectQuestions(0) {}

void QuizEngine::loadDictionary(const std::vector<std::string>& words) {
    fullDictionary.clear();
    alphagramToWords.clear();
    
    for (const auto& w : words) {
        if (w.empty()) continue;
        fullDictionary.insert(w);
        std::string alphaG = getAlphagram(w);
        alphagramToWords[alphaG].push_back(w);
    }
}

std::string QuizEngine::getAlphagram(const std::string& word) const {
    std::string sorted = word;
    std::sort(sorted.begin(), sorted.end());
    return sorted;
}

double QuizEngine::getProbabilityScore(const std::string& alphagram) const {
    int counts[26] = {0};
    for (char c : alphagram) {
        if (c >= 'A' && c <= 'Z') {
            counts[c - 'A']++;
        }
    }
    long long score = 1;
    for (int i = 0; i < 26; i++) {
        if (counts[i] > 0) {
            score *= choose(getLetterFrequency('A' + i), counts[i]);
        }
    }
    return (double)score;
}

void QuizEngine::computeHooks(const std::string& word, std::string& front, std::string& back) const {
    front.clear();
    back.clear();
    
    std::string testWord = " " + word;
    for (char c = 'A'; c <= 'Z'; ++c) {
        testWord[0] = c;
        if (fullDictionary.count(testWord) > 0) {
            front += c;
        }
    }
    
    testWord = word + " ";
    for (char c = 'A'; c <= 'Z'; ++c) {
        testWord[word.length()] = c;
        if (fullDictionary.count(testWord) > 0) {
            back += c;
        }
    }
}

void QuizEngine::generateQuiz(int type, const std::vector<std::string>& pool, int order) {
    questions.clear();
    currentQuestionIndex = -1;
    currentQuestionChecked = false;
    quizType = type;
    
    totalQuestions = 0;
    totalCorrect = 0;
    totalMissed = 0;
    totalIncorrect = 0;
    fullyCorrectQuestions = 0;
    
    if (pool.empty()) return;
    
    if (type == QuizAnagrams || type == QuizAnagramsWithHooks) {
        // Find unique alphagrams in the pool, preserving their order of first appearance
        std::vector<std::string> orderedAlphagrams;
        std::unordered_set<std::string> seenAlphagrams;
        for (const auto& w : pool) {
            std::string alphaG = getAlphagram(w);
            if (seenAlphagrams.count(alphaG) == 0) {
                seenAlphagrams.insert(alphaG);
                orderedAlphagrams.push_back(alphaG);
            }
        }
        
        for (const auto& alphaG : orderedAlphagrams) {
            auto it = alphagramToWords.find(alphaG);
            if (it == alphagramToWords.end() || it->second.empty()) continue;
            
            QuizQuestion q;
            q.questionText = alphaG;
            q.answers = it->second;
            
            // Compute hooks for each answer
            for (const auto& ans : q.answers) {
                std::string f, b;
                computeHooks(ans, f, b);
                q.frontHooks.push_back(f);
                q.backHooks.push_back(b);
            }
            questions.push_back(q);
        }
    } 
    else if (type == QuizBuild) {
        // Build quiz: for each word in pool, find all words of length+1 that contain it
        std::unordered_set<std::string> seenBaseWords;
        for (const auto& w : pool) {
            if (w.empty()) continue;
            if (seenBaseWords.count(w) > 0) continue;
            seenBaseWords.insert(w);
            
            QuizQuestion q;
            q.questionText = w; // The question is the word itself
            
            // Find builds by adding a letter A-Z
            std::unordered_set<std::string> addedWords;
            for (char c = 'A'; c <= 'Z'; ++c) {
                std::string extended = w + c;
                std::string alphaG = getAlphagram(extended);
                auto it = alphagramToWords.find(alphaG);
                if (it != alphagramToWords.end()) {
                    for (const auto& buildWord : it->second) {
                        addedWords.insert(buildWord);
                    }
                }
            }
            
            if (addedWords.empty()) continue;
            
            q.answers.assign(addedWords.begin(), addedWords.end());
            std::sort(q.answers.begin(), q.answers.end());
            
            for (const auto& ans : q.answers) {
                std::string f, b;
                computeHooks(ans, f, b);
                q.frontHooks.push_back(f);
                q.backHooks.push_back(b);
            }
            questions.push_back(q);
        }
    }
    
    if (questions.empty()) return;
    
    // Question ordering
    if (order == AlphabeticalOrder) {
        std::sort(questions.begin(), questions.end(), [](const QuizQuestion& a, const QuizQuestion& b) {
            return a.questionText < b.questionText;
        });
    } 
    else if (order == RandomOrder) {
        unsigned seed = std::chrono::system_clock::now().time_since_epoch().count();
        std::shuffle(questions.begin(), questions.end(), std::default_random_engine(seed));
    } 
    else if (order == ProbabilityOrder) {
        std::sort(questions.begin(), questions.end(), [this](const QuizQuestion& a, const QuizQuestion& b) {
            // Sort descending by probability
            double pA = getProbabilityScore(quizType == QuizBuild ? getAlphagram(a.questionText) : a.questionText);
            double pB = getProbabilityScore(quizType == QuizBuild ? getAlphagram(b.questionText) : b.questionText);
            if (pA != pB) {
                return pA > pB;
            }
            return a.questionText < b.questionText;
        });
    }
    
    totalQuestions = questions.size();
    currentQuestionIndex = 0;
    currentQuestionChecked = false;
    
    // Load first question answers
    correctAnswersSet.clear();
    for (const auto& ans : questions[0].answers) {
        correctAnswersSet.insert(ans);
    }
    userCorrectAnswers.clear();
    userIncorrectAnswers.clear();
}

std::string QuizEngine::getCurrentQuestionJson() const {
    if (currentQuestionIndex < 0 || currentQuestionIndex >= (int)questions.size()) {
        return "{}";
    }
    
    const auto& q = questions[currentQuestionIndex];
    std::stringstream ss;
    ss << "{";
    ss << "\"questionText\":\"" << q.questionText << "\",";
    ss << "\"totalAnswers\":" << q.answers.size() << ",";
    ss << "\"correctAnswersCount\":" << userCorrectAnswers.size() << ",";
    ss << "\"checked\":" << (currentQuestionChecked ? "true" : "false") << ",";
    
    // userCorrectAnswers list
    ss << "\"userCorrectAnswers\":[";
    bool first = true;
    for (const auto& u : userCorrectAnswers) {
        if (!first) ss << ",";
        ss << "\"" << u << "\"";
        first = false;
    }
    ss << "],";
    
    // userIncorrectAnswers list
    ss << "\"userIncorrectAnswers\":[";
    first = true;
    for (const auto& u : userIncorrectAnswers) {
        if (!first) ss << ",";
        ss << "\"" << u << "\"";
        first = false;
    }
    ss << "]";
    ss << "}";
    
    return ss.str();
}

bool QuizEngine::submitAnswer(const std::string& answer) {
    if (currentQuestionChecked || currentQuestionIndex < 0 || currentQuestionIndex >= (int)questions.size()) {
        return false;
    }
    
    // Trim and uppercase
    std::string clean = answer;
    clean.erase(0, clean.find_first_not_of(" \t\r\n"));
    clean.erase(clean.find_last_not_of(" \t\r\n") + 1);
    std::transform(clean.begin(), clean.end(), clean.begin(), ::toupper);
    
    if (clean.empty()) return false;
    
    std::string targetWord = clean;
    std::string subFront = "";
    std::string subBack = "";
    bool specifiedHooks = false;
    
    // Handle FRONT:WORD:BACK format
    size_t firstColon = clean.find(':');
    if (firstColon != std::string::npos) {
        size_t secondColon = clean.find(':', firstColon + 1);
        if (secondColon != std::string::npos) {
            subFront = clean.substr(0, firstColon);
            targetWord = clean.substr(firstColon + 1, secondColon - firstColon - 1);
            subBack = clean.substr(secondColon + 1);
            specifiedHooks = true;
        }
    }
    
    // Check if targetWord is a correct answer
    if (correctAnswersSet.count(targetWord) > 0) {
        // If they specify hooks, check if those hooks are correct too
        if (quizType == QuizAnagramsWithHooks && specifiedHooks) {
            // Find index of targetWord in answers list
            const auto& q = questions[currentQuestionIndex];
            int idx = -1;
            for (size_t i = 0; i < q.answers.size(); ++i) {
                if (q.answers[i] == targetWord) {
                    idx = i;
                    break;
                }
            }
            
            if (idx != -1) {
                std::string actualF = q.frontHooks[idx];
                std::string actualB = q.backHooks[idx];
                
                // Sort actual and submitted to allow order-agnostic checking
                std::string sortedActualF = actualF; std::sort(sortedActualF.begin(), sortedActualF.end());
                std::string sortedSubF = subFront; std::sort(sortedSubF.begin(), sortedSubF.end());
                std::string sortedActualB = actualB; std::sort(sortedActualB.begin(), sortedActualB.end());
                std::string sortedSubB = subBack; std::sort(sortedSubB.begin(), sortedSubB.end());
                
                if (sortedActualF == sortedSubF && sortedActualB == sortedSubB) {
                    if (userCorrectAnswers.count(targetWord) == 0) {
                        userCorrectAnswers.insert(targetWord);
                        totalCorrect++;
                        if (userCorrectAnswers.size() == correctAnswersSet.size()) {
                            checkAnswers();
                        }
                        return true;
                    }
                    return false;
                }
            }
        } 
        else {
            // Simple word checking
            if (userCorrectAnswers.count(targetWord) == 0) {
                userCorrectAnswers.insert(targetWord);
                totalCorrect++;
                if (userCorrectAnswers.size() == correctAnswersSet.size()) {
                    checkAnswers();
                }
                return true;
            }
            return false;
        }
    }
    
    // If we reach here, it's incorrect
    userIncorrectAnswers.insert(clean); // Store original submission
    return false;
}

std::string QuizEngine::checkAnswers() {
    if (currentQuestionIndex < 0 || currentQuestionIndex >= (int)questions.size()) {
        return "{}";
    }
    
    bool wasCheckedAlready = currentQuestionChecked;
    currentQuestionChecked = true;
    
    const auto& q = questions[currentQuestionIndex];
    
    if (!wasCheckedAlready) {
        // Add all user incorrect answers to stats
        totalIncorrect += userIncorrectAnswers.size();
        
        // Count missed answers
        int missedThisQuestion = 0;
        for (const auto& ans : q.answers) {
            if (userCorrectAnswers.count(ans) == 0) {
                missedThisQuestion++;
            }
        }
        totalMissed += missedThisQuestion;
        
        if (userCorrectAnswers.size() == q.answers.size()) {
            fullyCorrectQuestions++;
        }
    }
    
    // Build check results JSON
    std::stringstream ss;
    ss << "{";
    ss << "\"questionText\":\"" << q.questionText << "\",";
    ss << "\"answers\":[";
    for (size_t i = 0; i < q.answers.size(); ++i) {
        if (i > 0) ss << ",";
        ss << "{";
        ss << "\"word\":\"" << q.answers[i] << "\",";
        ss << "\"front\":\"" << q.frontHooks[i] << "\",";
        ss << "\"back\":\"" << q.backHooks[i] << "\",";
        ss << "\"status\":\"" << (userCorrectAnswers.count(q.answers[i]) > 0 ? "correct" : "missed") << "\"";
        ss << "}";
    }
    ss << "],";
    
    ss << "\"incorrectAnswers\":[";
    bool first = true;
    for (const auto& inc : userIncorrectAnswers) {
        if (!first) ss << ",";
        ss << "\"" << inc << "\"";
        first = false;
    }
    ss << "]";
    ss << "}";
    
    return ss.str();
}

bool QuizEngine::nextQuestion() {
    if (currentQuestionIndex < 0 || currentQuestionIndex + 1 >= (int)questions.size()) {
        return false;
    }
    
    currentQuestionIndex++;
    currentQuestionChecked = false;
    
    const auto& q = questions[currentQuestionIndex];
    correctAnswersSet.clear();
    for (const auto& ans : q.answers) {
        correctAnswersSet.insert(ans);
    }
    userCorrectAnswers.clear();
    userIncorrectAnswers.clear();
    
    return true;
}

std::string QuizEngine::getProgressJson() const {
    std::stringstream ss;
    ss << "{";
    ss << "\"totalQuestions\":" << totalQuestions << ",";
    ss << "\"currentQuestion\":" << (currentQuestionIndex + 1) << ",";
    ss << "\"totalCorrect\":" << totalCorrect << ",";
    ss << "\"totalMissed\":" << totalMissed << ",";
    ss << "\"totalIncorrect\":" << totalIncorrect << ",";
    ss << "\"fullyCorrectQuestions\":" << fullyCorrectQuestions;
    ss << "}";
    return ss.str();
}

void QuizEngine::restoreProgress(int questionIndex, int totalCorrectVal, int totalMissedVal, int totalIncorrectVal, int fullyCorrectVal, const std::vector<std::string>& userCorrect, const std::vector<std::string>& userIncorrect, bool checked) {
    if (questionIndex < 0 || questionIndex >= (int)questions.size()) {
        return;
    }
    
    currentQuestionIndex = questionIndex;
    totalCorrect = totalCorrectVal;
    totalIncorrect = totalIncorrectVal;
    fullyCorrectQuestions = fullyCorrectVal;
    currentQuestionChecked = checked;
    
    // Calculate totalMissed for previous completed questions
    int completedPossible = 0;
    for (int i = 0; i < questionIndex; ++i) {
        completedPossible += questions[i].answers.size();
    }
    int prevCorrect = totalCorrectVal - userCorrect.size();
    totalMissed = std::max(0, completedPossible - prevCorrect);
    
    // Populate active question user answers
    userCorrectAnswers.clear();
    for (const auto& w : userCorrect) {
        userCorrectAnswers.insert(w);
    }
    
    userIncorrectAnswers.clear();
    for (const auto& w : userIncorrect) {
        userIncorrectAnswers.insert(w);
    }
    
    // Set correctAnswersSet for the active question
    correctAnswersSet.clear();
    for (const auto& ans : questions[currentQuestionIndex].answers) {
        correctAnswersSet.insert(ans);
    }
}
